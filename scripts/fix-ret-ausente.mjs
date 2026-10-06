/**
 * RET de stand-by marcados ausentes por AUTO_T30. SOLO LECTURA por defecto.
 *
 *   node scripts/fix-ret-ausente.mjs
 *   node scripts/fix-ret-ausente.mjs --empresa pruebas_sa
 *   node scripts/fix-ret-ausente.mjs --apply --allow-prod
 *
 * --apply escribe en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');
const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : 'pruebas_sa';

if (apply && !allowProd) {
  console.error('Para escribir hace falta --apply --allow-prod');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function fold(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isRetShift(shift) {
  if (!shift) return false;
  if (upper(shift.code) === 'RET' || upper(shift.shiftCode) === 'RET' || upper(shift.type) === 'RET') return true;
  if (shift.isReten === true) return true;
  if (fold(shift.positionName) === 'reten' || fold(shift.type) === 'reten') return true;
  if (upper(shift.deploymentRole) === 'POOL' && shift.countsForCoverage === false) return true;
  return false;
}

const CLEAR = [
  'isAbsent',
  'status',
  'absenceType',
  'absenceDetectedAt',
  'absenceDetectedBy',
  'absenceId',
  'notifiedAbsent',
  'vacancyCreatedForAbsence',
  'vacancyOrigin',
  'absenceVacancyOpenedAt',
  'vacanteProtocoloAt',
  'vacanteEscalada',
];

const NOV_TIPOS = new Set([
  'AUSENCIA_AUTO',
  'VACANTE_OPERACIONES',
  'VACANTE_PLANIFICACION',
  'VACANTE_PROTOCOLO_COBERTURA',
]);

const snap = await db.collection('turnos').where('isAbsent', '==', true).get();
const rows = snap.docs.filter((d) => {
  const data = d.data();
  if (empresaId && String(data.empresaId || '') !== empresaId) return false;
  if (!isRetShift(data)) return false;
  return upper(data.absenceDetectedBy) === 'AUTO_T30';
});

console.log(`RET ausentes AUTO_T30: ${rows.length} (leídos ${snap.size}, empresa=${empresaId || '*'}) modo=${apply ? 'APPLY' : 'dryRun'}`);

for (const docSnap of rows) {
  const shift = docSnap.data();
  const prev = {};
  for (const key of CLEAR) {
    if (shift[key] !== undefined) prev[key] = shift[key];
  }
  const nombre = String(shift.employeeName || docSnap.id);
  console.log(`${apply ? 'FIX' : 'DRY'}\t${docSnap.id}\t${nombre}\t${upper(shift.code) || fold(shift.positionName)}`);

  const ausSnap = await db.collection('ausencias').where('shiftId', '==', docSnap.id).get();
  const novSnap = await db.collection('novedades').where('shiftId', '==', docSnap.id).get();
  const ausencias = ausSnap.docs.filter((d) => {
    const row = d.data();
    const tipo = upper(row.absenceType);
    const origin = upper(row.origin);
    return tipo === 'AA' || origin === 'AUTO_T30' || origin === 'AUTO_DEMO';
  });
  const novedades = novSnap.docs.filter((d) => NOV_TIPOS.has(String(d.data().type || '')));
  console.log(`\tausencias ${ausencias.length}\tnovedades ${novedades.length}`);

  if (!apply) continue;

  const patch = { retFixPrev: prev, retFixAt: FieldValue.serverTimestamp() };
  for (const key of CLEAR) {
    if (key === 'status' && upper(shift.status) !== 'ABSENT') continue;
    if (shift[key] !== undefined) patch[key] = FieldValue.delete();
  }
  await docSnap.ref.update(patch);

  const motivo = 'RET stand-by: ausencia automática incorrecta';
  for (const aus of ausencias) {
    if (upper(aus.data().status) === 'ANULADA') continue;
    await aus.ref.update({
      status: 'ANULADA',
      anuladaAt: FieldValue.serverTimestamp(),
      anuladaMotivo: motivo,
    });
  }
  for (const nov of novedades) {
    if (upper(nov.data().status) === 'ANULADA') continue;
    await nov.ref.update({
      status: 'ANULADA',
      anuladaAt: FieldValue.serverTimestamp(),
      anuladaMotivo: motivo,
    });
  }
  await db.collection('audit_logs').add({
    action: 'FIX_RET_AUSENTE',
    actorName: 'script fix-ret-ausente',
    actorUid: 'SYSTEM',
    module: 'OPERACIONES',
    empresaId: shift.empresaId || null,
    shiftId: docSnap.id,
    details: `Limpia AA AUTO_T30 de RET ${nombre}. Ausencias ${ausencias.length}, novedades ${novedades.length}.`,
    retFixPrev: prev,
    timestamp: FieldValue.serverTimestamp(),
  });
}

console.log(apply ? 'Listo.' : 'dryRun: no escribió. Para aplicar: --apply --allow-prod');
