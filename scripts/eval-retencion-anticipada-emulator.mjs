/**
 * Retención del saliente recién a T+0. Solo emulador aislado (:8190).
 *
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ret-anticipada "node scripts/eval-retencion-anticipada-emulator.mjs"
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
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-ret-anticipada';
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { retainOutgoingForGap, syncRetentionVinculoOnTurnoWrite } = requireFn('./lib/coverage/coverageRetention.js');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

function at(h, min) {
  return Timestamp.fromDate(new Date(2026, 9, 5, h, min, 0, 0));
}

const ctx = {
  isEnabled: () => true,
  isDemo: () => false,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

async function seedSla(objectiveId) {
  await db.collection('servicios_sla').doc(`${objectiveId}_sla`).set({
    objectiveId,
    clientId: `${objectiveId}_cli`,
    status: 'active',
    positions: [{
      name: 'Puesto 2',
      quantity: 1,
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      coverageType: '24hs',
      allowedShiftTypes: [
        { code: 'M', startTime: '11:30', endTime: '15:15', hours: 8 },
        { code: 'T', startTime: '15:15', endTime: '23:15', hours: 8 },
      ],
    }],
  });
}

async function seedPair(prefix) {
  const objectiveId = `${prefix}_obj`;
  const empresaId = `${prefix}_emp`;
  const salId = `${prefix}_sal`;
  const entId = `${prefix}_ent`;
  await seedSla(objectiveId);
  await db.batch()
    .set(db.collection('turnos').doc(salId), {
      empresaId, objectiveId, positionName: 'Puesto 2',
      employeeId: `${prefix}_bosio`, employeeName: 'BOSIO',
      code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
      startTime: at(11, 30), endTime: at(15, 15),
      checkInTime: at(11, 38),
    })
    .set(db.collection('turnos').doc(entId), {
      empresaId, objectiveId, positionName: 'Puesto 2',
      employeeId: `${prefix}_tit`, employeeName: 'TITULAR',
      code: 'T', status: 'ABSENT', isAbsent: true,
      startTime: at(15, 15), endTime: at(23, 15),
    })
    .commit();
  return { objectiveId, empresaId, salId, entId };
}

const noon = at(12, 0).toMillis();
const quarter = at(15, 16).toMillis();

{
  const s = await seedPair(`ant_${Date.now()}_futuro`);
  const ent = (await db.collection('turnos').doc(s.entId).get()).data();
  const r = await retainOutgoingForGap(db, { id: s.entId, ...ent }, { sendPush: false, nowMs: noon });
  const sal = (await db.collection('turnos').doc(s.salId).get()).data();
  await runAutoCompletarTurnosPass(db, ctx, at(12, 30), { onlyOutgoingShiftId: s.salId });
  const mid = (await db.collection('turnos').doc(s.salId).get()).data();
  const ok = r.planned === true
    && sal?.isRetention !== true
    && sal?.retentionAbsenceShiftId === s.entId
    && !!sal?.retentionPlannedFor
    && mid?.isRetention !== true;
  report('ausencia a las 12: sin retención hasta el fin', ok, `planned=${r.planned} ret=${sal?.isRetention} mid=${mid?.isRetention}`);
}

{
  const s = await seedPair(`ant_${Date.now()}_cubre`);
  const ent = (await db.collection('turnos').doc(s.entId).get()).data();
  await retainOutgoingForGap(db, { id: s.entId, ...ent }, { sendPush: false, nowMs: noon });
  const quirogaId = `${s.salId}_quiroga`;
  const quiroga = {
    empresaId: s.empresaId, objectiveId: s.objectiveId, positionName: 'Puesto 2',
    employeeId: `${s.salId}_q`, employeeName: 'QUIROGA',
    code: 'T', status: 'PENDING', isPresent: false, isAbsent: false,
    startTime: at(15, 15), endTime: at(23, 15),
  };
  await db.collection('turnos').doc(s.entId).delete();
  await syncRetentionVinculoOnTurnoWrite(db, s.entId, ent, undefined);
  await db.collection('turnos').doc(quirogaId).set(quiroga);
  await syncRetentionVinculoOnTurnoWrite(db, quirogaId, undefined, quiroga);
  const sal = (await db.collection('turnos').doc(s.salId).get()).data();
  const ok = sal?.isRetention !== true && !sal?.retentionPlannedFor && !sal?.retentionAbsenceShiftId;
  report('cubierta en planificación: nada', ok, `ret=${sal?.isRetention} plan=${!!sal?.retentionPlannedFor} link=${sal?.retentionAbsenceShiftId || '-'}`);
}

{
  const s = await seedPair(`ant_${Date.now()}_t0`);
  const ent = (await db.collection('turnos').doc(s.entId).get()).data();
  await retainOutgoingForGap(db, { id: s.entId, ...ent }, { sendPush: false, nowMs: noon });
  await runAutoCompletarTurnosPass(db, ctx, Timestamp.fromMillis(quarter), { onlyOutgoingShiftId: s.salId });
  const sal = (await db.collection('turnos').doc(s.salId).get()).data();
  const started = sal?.retentionStartedAt?.toMillis?.() ?? sal?.autoRetentionAt?.toMillis?.() ?? 0;
  const ok = sal?.isRetention === true
    && sal?.isCompleted !== true
    && started === at(15, 15).toMillis();
  report('sin cubrir y el relevo no ficha: retención desde 15:15', ok, `ret=${sal?.isRetention} st=${sal?.status} started=${started} end=${at(15, 15).toMillis()} reason=${sal?.completionReason || sal?.retentionReason || ''}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`retencion anticipada ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
