/**
 * KOPP 07/10 pruebas_sa, Peaje 9 Norte · Puesto 2.
 * La fichada quedó en el REF origen y también en el ops_cov: dos presentes del mismo horario.
 * Deja las horas solo en la cobertura.
 *
 *   node scripts/fix-fichada-cobertura-kopp.mjs
 *   node scripts/fix-fichada-cobertura-kopp.mjs --apply --allow-prod
 *
 * --apply escribe en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const SOURCE_ID = 'Z3AYG5ZU5D0ei9nrdGNG';
const COV_ID = 'ops_cov_MsbAUhKA0HyMoytSVOS9_KX4S0jSdzXkB1RI3Ees7';
const TITULAR_ID = 'MsbAUhKA0HyMoytSVOS9';
const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
  console.error('Rechazo --apply contra prod. Pasá --allow-prod solo con OK de Mauro.');
  process.exit(1);
}

const [srcSnap, covSnap] = await Promise.all([
  db.collection('turnos').doc(SOURCE_ID).get(),
  db.collection('turnos').doc(COV_ID).get(),
]);
if (!srcSnap.exists || !covSnap.exists) {
  console.error('No están los dos turnos.', { fuente: srcSnap.exists, cobertura: covSnap.exists });
  process.exit(1);
}
const src = srcSnap.data();
const cov = covSnap.data();
const mismoEmpleado = String(src.employeeId || '') === String(cov.employeeId || '');
const fuenteTieneReloj = src.isPresent === true
  || String(src.status || '').toUpperCase() === 'PRESENT'
  || !!src.realStartTime
  || !!src.checkInAt;
const coberturaTieneReloj = cov.isPresent === true || !!cov.realStartTime || !!cov.checkInAt;

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} KOPP fichada duplicada`);
console.log(`  fuente ${SOURCE_ID} code=${src.code} status=${src.status} present=${src.isPresent === true} coverageUsed=${src.coverageUsed === true}`);
console.log(`  cobertura ${COV_ID} code=${cov.code} status=${cov.status} present=${cov.isPresent === true}`);
console.log(`  mismo empleado=${mismoEmpleado} reloj en fuente=${fuenteTieneReloj} reloj en cobertura=${coberturaTieneReloj}`);

if (!mismoEmpleado || String(cov.sourceShiftId || '') !== SOURCE_ID) {
  console.error('No es el par fuente/cobertura de KOPP. No escribo.');
  process.exit(1);
}
if (!fuenteTieneReloj) {
  console.log('La fuente ya no tiene fichada. Nada que sacar del cómputo.');
  process.exit(0);
}

const del = admin.firestore.FieldValue.delete();
const parche = {
  coverageUsed: true,
  coverageDocId: COV_ID,
  coverageUsedForShiftId: TITULAR_ID,
  isPresent: false,
  isLate: false,
  lateMinutes: 0,
  isDeleted: true,
  status: 'CANCELLED',
  deletedReason: 'CONVERTIDO_EN_COBERTURA',
  convertedToCoverageDocId: COV_ID,
  checkInAt: del,
  checkInTime: del,
  realStartTime: del,
  checkInMethod: del,
  checkInCoords: del,
  checkInRecordedAt: del,
};
console.log('  parche fuente: coverageUsed, CANCELLED, sin reloj. La cobertura conserva la fichada.');
if (!apply) process.exit(0);

const batch = db.batch();
batch.update(srcSnap.ref, parche);
if (!coberturaTieneReloj) {
  batch.set(covSnap.ref, {
    isPresent: true,
    status: 'PRESENT',
    isAwaitingCoverageCheckIn: false,
    ...(src.checkInAt ? { checkInAt: src.checkInAt } : {}),
    ...(src.checkInTime ? { checkInTime: src.checkInTime } : {}),
    ...(src.realStartTime ? { realStartTime: src.realStartTime } : {}),
    ...(src.checkInMethod ? { checkInMethod: src.checkInMethod } : {}),
  }, { merge: true });
  console.log('  la cobertura no tenía reloj: se copia el de la fuente.');
}
batch.set(db.collection('audit_logs').doc(), {
  action: 'FIX_HORAS_COBERTURA_REF',
  empresaId: src.empresaId || cov.empresaId || 'pruebas_sa',
  shiftId: COV_ID,
  sourceShiftId: SOURCE_ID,
  titularShiftId: TITULAR_ID,
  at: admin.firestore.FieldValue.serverTimestamp(),
});
await batch.commit();
console.log('escrito');
