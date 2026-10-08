/**
 * Cierra el seguimiento de convocatorias ACCEPTED cuyo guardia ya fichó
 * el ops_cov, o cuyo hueco ya terminó. No reabre nada.
 *
 *   node scripts/fix-seguimiento-convocado-fichado.mjs
 *   node scripts/fix-seguimiento-convocado-fichado.mjs --empresa pruebas_sa --apply --allow-prod
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
const empIdx = args.indexOf('--empresa');
const empresaId = empIdx >= 0 ? String(args[empIdx + 1] || '').trim() : '';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
  console.error('Rechazo --apply contra prod. Pasá --allow-prod solo con OK de Mauro.');
  process.exit(1);
}

function ms(v) {
  return v?.toMillis?.() || (v ? new Date(v).getTime() : 0) || 0;
}

function fichado(data) {
  if (!data || data.isDeleted === true) return false;
  const st = String(data.status || '').toUpperCase();
  if (st === 'CANCELLED') return false;
  return data.isPresent === true || st === 'PRESENT' || ms(data.checkInAt) > 0 || ms(data.realStartTime) > 0;
}

function covId(titular, employee) {
  return `ops_cov_${titular}_${employee}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

const snap = await db.collection('convocatorias_cobertura').where('status', '==', 'ACCEPTED').get();
const now = admin.firestore.Timestamp.now();
const planes = [];

for (const doc of snap.docs) {
  const conv = doc.data();
  if (empresaId && String(conv.empresaId || '') !== empresaId) continue;
  if (ms(conv.followUpClosedAt) > 0) continue;
  const tipo = String(conv.type || '').toUpperCase();
  if (tipo === 'EXTEND' || tipo === 'LLEGADA_TARDE') continue;
  const titular = String(conv.shiftId || '').trim();
  const employee = String(conv.candidateEmployeeId || '').trim();
  if (!titular || !employee) continue;
  const cov = (await db.collection('turnos').doc(covId(titular, employee)).get()).data();
  const fin = ms(conv.gapEndAt) || ms(conv.endTime) || ms(cov?.endTime);
  const yaFicho = fichado(cov);
  const termino = fin > 0 && fin <= now.toMillis();
  if (!yaFicho && !termino) continue;
  planes.push({ doc, conv, yaFicho, reason: yaFicho ? 'FICHO' : 'HUECO_TERMINADO' });
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'}${empresaId ? ` ${empresaId}` : ''}: ${planes.length} seguimientos a cerrar`);
for (const row of planes) {
  console.log(`  ${row.doc.id} ${row.conv.candidateEmployeeName || row.conv.candidateEmployeeId} ${row.reason} turno=${row.conv.shiftId}`);
}
if (!apply || planes.length === 0) process.exit(0);

let escritos = 0;
for (const row of planes) {
  await row.doc.ref.update({
    reminderPending: false,
    delayAlertPending: false,
    followUpClosedAt: now,
    followUpClosedReason: row.reason,
    ...(row.yaFicho ? { checkedInAt: now } : {}),
  });
  await db.collection('audit_logs').add({
    action: 'FIX_SEGUIMIENTO_CONVOCADO_FICHADO',
    empresaId: row.conv.empresaId || null,
    convocatoriaId: row.doc.id,
    shiftId: row.conv.shiftId || null,
    reason: row.reason,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  escritos += 1;
}
console.log(`escritos ${escritos}`);
