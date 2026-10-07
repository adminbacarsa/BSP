/**
 * Una cobertura REF/ESC/RET/FT = un solo turno (el ops_cov, código del titular).
 * Anula la fuente si sigue viva y, si la fichada quedó ahí, la pasa a la cobertura.
 * Incluye el caso KOPP 07/10 (Peaje 9 Norte · Puesto 2) cuando la empresa es pruebas_sa.
 *
 *   node scripts/fix-cobertura-un-turno.mjs --empresa pruebas_sa
 *   node scripts/fix-cobertura-un-turno.mjs --empresa pruebas_sa --apply --allow-prod
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
const empresaId = empIdx >= 0 ? String(args[empIdx + 1] || '').trim() : 'pruebas_sa';
// FT conserva el franco origen (P9e): no se anula. Solo REF/ESC/RET se convierten.
const TIPOS = new Set(['REF', 'ESC', 'RET']);

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

if (!empresaId) {
  console.error('Falta --empresa');
  process.exit(1);
}
if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
  console.error('Rechazo --apply contra prod. Pasá --allow-prod solo con OK de Mauro.');
  process.exit(1);
}

function reloj(data) {
  return data?.isPresent === true
    || String(data?.status || '').toUpperCase() === 'PRESENT'
    || !!data?.realStartTime
    || !!data?.checkInAt;
}

function anulada(data) {
  return data?.isDeleted === true && String(data?.status || '').toUpperCase() === 'CANCELLED' && !reloj(data);
}

const snap = await db.collection('turnos').where('empresaId', '==', empresaId).get();
const porId = new Map(snap.docs.map((d) => [d.id, d]));
const planes = [];

for (const doc of snap.docs) {
  const cov = doc.data();
  if (String(cov.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') continue;
  if (cov.coverageSuperseded === true || cov.isDeleted === true) continue;
  const tipo = String(cov.coverageType || '').toUpperCase();
  if (!TIPOS.has(tipo)) continue;
  if (cov.coverageHoursOnSource === true) continue;
  const sourceId = String(cov.sourceShiftId || '').trim();
  const srcDoc = sourceId ? porId.get(sourceId) : null;
  const src = srcDoc?.data();
  const faltaSello = !cov.codigoOriginal || !cov.coverageForShiftId;
  const copiarReloj = !!src && reloj(src) && !reloj(cov);
  const anular = !!src && !anulada(src);
  if (!faltaSello && !copiarReloj && !anular) continue;
  planes.push({ doc, cov, srcDoc, src, tipo, faltaSello, copiarReloj, anular });
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${empresaId}: ${planes.length} coberturas a dejar en un turno`);
for (const row of planes) {
  const nombre = row.cov.employeeName || row.cov.employeeId;
  console.log(`  ${row.doc.id} ${nombre} ${row.tipo}→${row.cov.code || ''} fuente=${row.srcDoc?.id || 'sin fuente'} anular=${row.anular} copiarReloj=${row.copiarReloj} sello=${row.faltaSello}`);
}
if (!apply || planes.length === 0) process.exit(0);

const del = admin.firestore.FieldValue.delete();
let escritos = 0;
for (const row of planes) {
  const titularId = String(row.cov.absenceShiftId || row.cov.coveredShiftId || row.cov.coverageForShiftId || '').trim();
  const batch = db.batch();
  const sello = {};
  if (!row.cov.codigoOriginal && row.src) {
    sello.codigoOriginal = String(row.src.code || row.src.shiftCode || row.tipo).trim().toUpperCase();
  }
  if (!row.cov.coverageForShiftId && titularId) sello.coverageForShiftId = titularId;
  if (row.copiarReloj) {
    Object.assign(sello, {
      isPresent: true,
      status: 'PRESENT',
      isAwaitingCoverageCheckIn: false,
      ...(row.src.checkInAt ? { checkInAt: row.src.checkInAt } : {}),
      ...(row.src.checkInTime ? { checkInTime: row.src.checkInTime } : {}),
      ...(row.src.realStartTime ? { realStartTime: row.src.realStartTime } : {}),
      ...(row.src.realEndTime ? { realEndTime: row.src.realEndTime } : {}),
      ...(row.src.checkInMethod ? { checkInMethod: row.src.checkInMethod } : {}),
    });
  }
  if (Object.keys(sello).length) batch.set(row.doc.ref, sello, { merge: true });
  if (row.anular && row.srcDoc) {
    batch.update(row.srcDoc.ref, {
      coverageUsed: true,
      coverageDocId: row.doc.id,
      coverageUsedForShiftId: titularId || null,
      isPresent: false,
      isLate: false,
      lateMinutes: 0,
      isDeleted: true,
      status: 'CANCELLED',
      deletedReason: 'CONVERTIDO_EN_COBERTURA',
      convertedToCoverageDocId: row.doc.id,
      checkInAt: del,
      checkInTime: del,
      realStartTime: del,
      realEndTime: del,
      checkInMethod: del,
      checkInCoords: del,
      checkInRecordedAt: del,
    });
  }
  batch.set(db.collection('audit_logs').doc(), {
    action: 'FIX_COBERTURA_UN_TURNO',
    empresaId,
    shiftId: row.doc.id,
    sourceShiftId: row.srcDoc?.id || null,
    titularShiftId: titularId || null,
    tipo: row.tipo,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  escritos += 1;
}
console.log(`escritos ${escritos}`);
