/**
 * Convocado a un hueco futuro vs hueco ya empezado.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-conv-fut "node scripts/eval-convocado-futuro-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-conv-fut' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { recordConvocadoAcceptEta } = requireFn('./lib/coverage/convocadoAcceptEta.js');
const { runConvocadoFollowUp } = requireFn('./lib/attendance/convocadoFollowUp.js');
const { runConvocadoAbsentPass } = requireFn('./lib/attendance/convocadoAbsentPass.js');
const { buildOpsCoverageDocId } = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail || ''}`);
}

const accept = new Date('2026-10-05T13:56:00-03:00');
const gap = new Date('2026-10-05T16:00:00-03:00');
const gapEnd = new Date('2026-10-05T17:00:00-03:00');

async function seed({ id, emp, acceptAt, gapStart, gapFinish }) {
  const tit = `${id}_tit`;
  const conv = `${id}_conv`;
  const cov = buildOpsCoverageDocId(tit, emp);
  await db.collection('empleados').doc(emp).set({ employeeName: 'Sanchez, Laura Romina', empresaId: 'pruebas_sa' });
  await db.collection('turnos').doc(tit).set({
    empresaId: 'pruebas_sa',
    objectiveId: 'peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    code: 'T3',
    startTime: Timestamp.fromDate(gapStart),
    endTime: Timestamp.fromDate(gapFinish),
    isAbsent: true,
    status: 'ABSENT',
  });
  await db.collection('turnos').doc(cov).set({
    empresaId: 'pruebas_sa',
    objectiveId: 'peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'FT',
    employeeId: emp,
    employeeName: 'Sanchez, Laura Romina',
    startTime: Timestamp.fromDate(gapStart),
    endTime: Timestamp.fromDate(gapFinish),
    acceptedAt: Timestamp.fromDate(acceptAt),
    status: 'PENDING',
    isPresent: false,
  });
  await db.collection('convocatorias_cobertura').doc(conv).set({
    empresaId: 'pruebas_sa',
    shiftId: tit,
    objectiveId: 'peaje',
    objectiveName: 'Peaje 9 Norte',
    type: 'FT',
    status: 'ACCEPTED',
    candidateEmployeeId: emp,
    candidateEmployeeName: 'Sanchez, Laura Romina',
    respondedAt: Timestamp.fromDate(acceptAt),
  });
  return { tit, conv, cov };
}

async function main() {
  const fut = await seed({
    id: 'fut',
    emp: 'sanchez',
    acceptAt: accept,
    gapStart: gap,
    gapFinish: gapEnd,
  });
  await recordConvocadoAcceptEta(db, fut.conv, { now: Timestamp.fromDate(accept) });
  const conv = (await db.collection('convocatorias_cobertura').doc(fut.conv).get()).data();
  const cov = (await db.collection('turnos').doc(fut.cov).get()).data();
  report(
    'ETA del hueco futuro es 16:00',
    conv.convocadoGapFuture === true
      && conv.expectedArrivalAt.toMillis() === gap.getTime()
      && cov.expectedArrivalAt.toMillis() === gap.getTime()
      && conv.etaMinutes === 10,
    `eta=${conv.etaMinutes} exp=${new Date(conv.expectedArrivalAt.toMillis()).toISOString()}`,
  );
  report(
    'recordatorio a las 15:40',
    conv.reminderAt.toMillis() === new Date('2026-10-05T15:40:00-03:00').getTime(),
    new Date(conv.reminderAt.toMillis()).toISOString(),
  );

  const early = await runConvocadoFollowUp(db, Timestamp.fromDate(new Date('2026-10-05T14:00:00-03:00')));
  const absent = await runConvocadoAbsentPass(db, Timestamp.fromDate(new Date('2026-10-05T14:00:00-03:00')));
  const mid = (await db.collection('convocatorias_cobertura').doc(fut.conv).get()).data();
  const covMid = (await db.collection('turnos').doc(fut.cov).get()).data();
  report(
    'a las 14:00 no hay recordatorio ni demorado ni ausencia',
    early === 0 && absent === 0 && !mid.reminderSentAt && mid.convocadoDemorado !== true && covMid.isAbsent !== true,
    `follow=${early} absent=${absent}`,
  );

  const tooEarly = evaluateServerCheckInWindow(cov, new Date('2026-10-05T15:40:00-03:00').getTime());
  const okPunch = evaluateServerCheckInWindow(
    { ...cov, etaMinutes: 10, acceptedAt: cov.acceptedAt, startTime: cov.startTime, endTime: cov.endTime, origin: 'OPERATIONS_COVERAGE', coverageType: 'FT' },
    new Date('2026-10-05T15:50:00-03:00').getTime(),
  );
  report('ficha 15:40 rechazada', tooEarly.rejectCode === 'TOO_EARLY', tooEarly.rejectCode || '');
  report('ficha 15:50 ok', okPunch.allowed === true && (okPunch.lateMinutes || 0) === 0, okPunch.rejectCode || 'ok');

  await runConvocadoFollowUp(db, Timestamp.fromDate(new Date('2026-10-05T15:41:00-03:00')));
  const reminded = (await db.collection('convocatorias_cobertura').doc(fut.conv).get()).data();
  report('recordatorio a las 15:41', !!reminded.reminderSentAt && reminded.convocadoDemorado !== true, '');

  const startedAt = new Date('2026-10-05T16:10:00-03:00');
  const ya = await seed({
    id: 'ya',
    emp: 'ya_emp',
    acceptAt: startedAt,
    gapStart: gap,
    gapFinish: gapEnd,
  });
  await recordConvocadoAcceptEta(db, ya.conv, { now: Timestamp.fromDate(startedAt) });
  const yaConv = (await db.collection('convocatorias_cobertura').doc(ya.conv).get()).data();
  const twoThirds = startedAt.getTime() + Math.round((10 * 2) / 3) * 60 * 1000;
  report(
    'hueco ya empezado: llegada = aceptación + viaje y recordatorio 2/3',
    yaConv.convocadoGapFuture !== true
      && yaConv.expectedArrivalAt.toMillis() === startedAt.getTime() + 10 * 60 * 1000
      && yaConv.reminderAt.toMillis() === twoThirds,
    `exp=${new Date(yaConv.expectedArrivalAt.toMillis()).toISOString()}`,
  );
  const before = await runConvocadoFollowUp(db, Timestamp.fromDate(new Date('2026-10-05T16:12:00-03:00')));
  const yaMid = (await db.collection('convocatorias_cobertura').doc(ya.conv).get()).data();
  report('hueco empezado: sin recordatorio antes de los 2/3', before === 0 && !yaMid.reminderSentAt, '');

  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    console.error(`\n${bad.length} falla(s)`);
    process.exit(1);
  }
  console.log('\nconvocado futuro ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
