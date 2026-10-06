/**
 * RET 00:00: sin aviso, sin AA a T+30, sin vacante. Solo emulador aislado (:8190).
 *
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ret-no-ausente "node scripts/eval-ret-no-ausente-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!host || host.endsWith(':8080')) {
  console.error('Este script corre solo en el emulador aislado (firebase.e2e-p2.json, :8190).');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-ret-no-ausente';
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
const { runShiftArrivalNotices } = requireFn('./lib/attendance/arrivalNotices.js');
const { stampTitularAbsenceVacancyMark } = requireFn('./lib/notifications/onGuardAbsenceDetected.js');
const { simulableShiftSkipReason } = requireFn('./lib/common/simulableShift.js');

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

const prefix = `retna_${Date.now()}`;
const empresaId = `${prefix}_emp`;
const objectiveId = `${prefix}_obj`;
const retId = `${prefix}_ret`;
const mId = `${prefix}_m`;
const zeroId = `${prefix}_zero`;
const midnight = Timestamp.fromDate(new Date(Date.UTC(2026, 9, 6, 3, 0, 0)));
const plus8 = Timestamp.fromMillis(midnight.toMillis() + 8 * 3600000);

await db.collection('empresas').doc(empresaId).set({ centroControlEnabled: true, modoDemoEnabled: false });
await db.collection('servicios_sla').doc(`${prefix}_sla`).set({
  empresaId,
  objectiveId,
  status: 'active',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
});
await db.collection('planificacion_estados').doc(`${empresaId}_${objectiveId}_2026_10`).set({
  publishedAt: Timestamp.now(),
});
await db.collection('empleados').doc(`${prefix}_qui`).set({ uid: `${prefix}_uid`, firstName: 'Quiroga' });
await db.collection('empleados').doc(`${prefix}_m`).set({ uid: `${prefix}_uidm`, firstName: 'Lopez' });

const base = {
  empresaId,
  objectiveId,
  objectiveName: 'Peaje 9 Norte',
  clientName: 'Cliente',
  positionName: 'Retén',
  employeeId: `${prefix}_qui`,
  employeeName: 'QUIROGA',
};
await db.collection('turnos').doc(retId).set({
  ...base,
  code: 'RET',
  type: 'Retén',
  deploymentRole: 'POOL',
  countsForCoverage: false,
  isReten: false,
  startTime: midnight,
  endTime: midnight,
  comments: 'Carga Masiva',
});
await db.collection('turnos').doc(mId).set({
  ...base,
  employeeId: `${prefix}_m`,
  employeeName: 'LOPEZ',
  positionName: 'Puesto 1',
  code: 'M',
  startTime: midnight,
  endTime: plus8,
});
await db.collection('turnos').doc(zeroId).set({
  ...base,
  employeeId: `${prefix}_m`,
  employeeName: 'LOPEZ',
  positionName: 'Puesto 1',
  code: 'M',
  startTime: midnight,
  endTime: midnight,
});

const cc = {
  anyEnabled: true,
  isEnabled: () => true,
  isDemo: () => false,
};
const headsUpNow = Timestamp.fromMillis(midnight.toMillis() - 2 * 60 * 1000);
const venisNow = Timestamp.fromMillis(midnight.toMillis() + 10 * 1000);
await runShiftArrivalNotices(db, headsUpNow, cc);
await runShiftArrivalNotices(db, venisNow, cc);

const ret = (await db.collection('turnos').doc(retId).get()).data();
const mañana = (await db.collection('turnos').doc(mId).get()).data();
report('aviso-ret', !ret.preStartArrivalNoticeAt && !ret.earlyRetentionAlertAt, 'RET sin T-5 ni Venís');
report('aviso-m', !!mañana.preStartArrivalNoticeAt, 'el M de control sí avisa');

const aa = await markShiftAbsent(db, retId, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
const retAfter = (await db.collection('turnos').doc(retId).get()).data();
report('aa-ret', aa.applied === false && retAfter.isAbsent !== true, 'sin AA');

const zero = await markShiftAbsent(db, zeroId, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
const zeroAfter = (await db.collection('turnos').doc(zeroId).get()).data();
report('aa-cero', zero.applied === false && zeroAfter.isAbsent !== true, 'duración 0');

await db.collection('turnos').doc(retId).update({ isAbsent: true, status: 'ABSENT' });
const stamp = await stampTitularAbsenceVacancyMark(db, retId);
const retVac = (await db.collection('turnos').doc(retId).get()).data();
report('vacante', stamp === 'SKIPPED' && retVac.vacancyCreatedForAbsence !== true, 'sin vacancyOrigin');

report('demo', simulableShiftSkipReason(ret) === 'RET', String(simulableShiftSkipReason(ret)));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`FALLA ${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`E2E RET ${results.length}/${results.length}`);
