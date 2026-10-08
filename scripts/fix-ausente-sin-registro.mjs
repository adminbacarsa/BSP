/**
 * Registra la ausencia RRHH de turnos que quedaron ABSENT sin doc en `ausencias`.
 * Solo AA (o sin tipo) de un titular con persona. Una licencia queda en «revisar a mano»
 * y no se escribe. Una vacante sin guardia se ignora.
 * Usa markShiftAbsent con FIX_SIN_REGISTRO: no cascada, no vacante, no push.
 *
 *   node scripts/fix-ausente-sin-registro.mjs --empresa pruebas_sa --desde 2026-10-01 --hasta 2026-10-31
 *   node scripts/fix-ausente-sin-registro.mjs --empresa pruebas_sa --desde 2026-10-08 --hasta 2026-10-08 --apply --allow-prod
 *
 * --apply escribe en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProd = args.includes('--allow-prod');
const empresaId = String(args[args.indexOf('--empresa') + 1] || '').trim();
const desde = String(args[args.indexOf('--desde') + 1] || '').trim();
const hasta = String(args[args.indexOf('--hasta') + 1] || '').trim();

if (!empresaId || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
  console.error('Uso: node scripts/fix-ausente-sin-registro.mjs --empresa ID --desde YYYY-MM-DD --hasta YYYY-MM-DD [--apply --allow-prod]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
  console.error('Rechazo --apply contra prod. Pasá --allow-prod solo con OK de Mauro.');
  process.exit(1);
}

function ms(v) {
  return v?.toMillis?.() || (v ? new Date(v).getTime() : 0) || 0;
}

function ymd(value) {
  const t = ms(value);
  if (!t) return '';
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function esVacanteSinPersona(id, shift) {
  const emp = String(shift.employeeId || '').trim();
  const empUp = emp.toUpperCase();
  const name = String(shift.employeeName || '').trim().toUpperCase();
  const origin = String(shift.origin || '').toUpperCase();
  if (!emp || empUp.startsWith('VACANTE') || empUp === 'SIN_COBERTURA' || empUp === 'SIN COBERTURA') return true;
  if (name === 'SIN COBERTURA' || name.startsWith('VACANTE')) return true;
  if (String(id).startsWith('autosinc_') || String(id).startsWith('autodev_')) return true;
  // isUnassigned en un titular con persona (sin cobertura, después cubierto) sigue siendo AA.
  if (shift.isVacancy === true) return true;
  if (
    origin === 'SLA_VIRTUAL'
    || origin === 'SLA_UNPLANNED_GAP'
    || origin === 'VACANTE_POR_AUSENCIA'
    || origin.includes('HUECO')
  ) return true;
  return false;
}

/** Licencia ya clasificada (Fallecimiento Familiar, V, E, L…). AA y vacío se registran. */
function esLicenciaARevisar(shift) {
  const tipo = String(shift.absenceType || '').trim();
  if (!tipo) return false;
  return tipo.toUpperCase() !== 'AA';
}

function linea(doc) {
  const s = doc.data();
  return `  ${doc.id} ${s.employeeName || s.employeeId || '—'} ${ymd(s.startTime)} ${s.code || ''} absenceType=${s.absenceType || '—'}`;
}

const registran = [];
const revisar = [];
const ignoran = [];
const vistos = new Set();
for (const campo of [
  db.collection('turnos').where('isAbsent', '==', true),
  db.collection('turnos').where('status', '==', 'ABSENT'),
]) {
  const snap = await campo.get();
  for (const doc of snap.docs) {
    if (vistos.has(doc.id)) continue;
    vistos.add(doc.id);
    const shift = doc.data();
    if (String(shift.empresaId || '') !== empresaId) continue;
    if (shift.isDeleted === true) continue;
    const dia = ymd(shift.startTime);
    if (!dia || dia < desde || dia > hasta) continue;
    const aus = await db.collection('ausencias').where('shiftId', '==', doc.id).limit(1).get();
    if (!aus.empty) continue;
    if (esVacanteSinPersona(doc.id, shift)) ignoran.push(doc);
    else if (esLicenciaARevisar(shift)) revisar.push(doc);
    else registran.push(doc);
  }
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${empresaId} ${desde}→${hasta}`);
console.log(`Se registran (AA): ${registran.length}`);
for (const doc of registran) console.log(linea(doc));
console.log(`Revisar a mano (tipo de licencia): ${revisar.length}`);
for (const doc of revisar) console.log(linea(doc));
console.log(`Se ignoran (vacante sin persona): ${ignoran.length}`);
for (const doc of ignoran) console.log(linea(doc));
if (!apply || registran.length === 0) process.exit(0);

const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
let escritos = 0;
for (const doc of registran) {
  const r = await markShiftAbsent(db, doc.id, {
    reason: 'FIX_SIN_REGISTRO',
    by: 'FIX_SIN_REGISTRO',
    skipCascadeSideEffects: true,
  });
  if (r.applied || r.alreadyAbsent) escritos += 1;
  await db.collection('audit_logs').add({
    action: 'FIX_AUSENTE_SIN_REGISTRO',
    module: 'OPERACIONES',
    empresaId,
    shiftId: doc.id,
    employeeId: doc.data().employeeId || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    details: `Ausencia registrada en histórico (${r.applied ? 'aplicada' : 'ya estaba'}).`,
  });
}
console.log(`Escritos: ${escritos}`);
