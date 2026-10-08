/**
 * Asignación directa REF urgente: al fichar el ops_cov se cierra el seguimiento.
 * Responder después (o una convocatoria de ayer ya cerrada) no reescribe nada.
 *
 * firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-recordatorio "node scripts/eval-recordatorio-fichado-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-recordatorio' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { crearConvocatoriaDoc } = requireFn('./lib/coverage/convocatoriasCobertura.js');
const { responderRecordatorioConvocadoShift } = requireFn('./lib/coverage/convocadoAcceptEta.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { runConvocadoFollowUp } = requireFn('./lib/attendance/convocadoFollowUp.js');
const { buildOpsCoverageDocId } = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const P = `rec_${Date.now()}`;
const EMP = `${P}_emp`;
const id = (n) => `${P}_${n}`;
const ar = (day, h, min) => Timestamp.fromDate(new Date(
  `2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`,
));

async function main() {
  const obj = id('peaje');
  const lallana = id('lallana');
  const tit = id('tit');
  const fuente = id('ref');
  await db.collection('empleados').doc(lallana).set({
    empresaId: EMP, uid: id('uid'), firstName: 'Laura', nombre: 'LALLANA',
  });
  await db.collection('turnos').doc(tit).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: id('baez'), employeeName: 'BAEZ', code: 'M',
    startTime: ar(8, 10, 45), endTime: ar(8, 12, 0),
    status: 'ABSENT', isAbsent: true,
  });
  await db.collection('turnos').doc(fuente).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: lallana, employeeName: 'LALLANA', code: 'REF',
    startTime: ar(8, 10, 45), endTime: ar(8, 12, 0), status: 'PENDING',
  });

  const directa = await crearConvocatoriaDoc(db, {
    empresaId: EMP,
    shiftId: tit,
    objectiveId: obj,
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    clientName: 'Cliente',
    shiftCode: 'M',
    startTime: ar(8, 10, 45),
    endTime: ar(8, 12, 0),
    type: 'REF',
    candidateEmployeeId: lallana,
    candidateEmployeeName: 'LALLANA',
    candidateShiftId: fuente,
    createdBy: 'OPERACIONES',
  }, { now: ar(8, 10, 40) });
  const covId = buildOpsCoverageDocId(tit, lallana);
  report('asignación directa', String(directa).startsWith('directa:'), directa);
  const covAntes = (await db.collection('turnos').doc(covId).get()).data();
  const convs = await db.collection('convocatorias_cobertura').where('shiftId', '==', tit).get();
  const convDoc = convs.docs.find((d) => d.data().empresaId === EMP && d.data().candidateEmployeeId === lallana);
  report(
    'el ops_cov guarda la convocatoria',
    covAntes?.coverageConvocatoriaId === convDoc?.id && convDoc?.data()?.status === 'ACCEPTED',
    covAntes?.coverageConvocatoriaId || '(sin id)',
  );

  await db.collection('turnos').doc(covId).set({
    coverageConvocatoriaId: admin.firestore.FieldValue.delete(),
    assignedByConvocatoria: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  await registrarPresencia(db, {
    shiftId: covId,
    source: 'OPERATIONS',
    empId: lallana,
    recordedAt: '2026-10-08T10:43:00-03:00',
  });
  const cov = (await db.collection('turnos').doc(covId).get()).data();
  const conv = (await convDoc.ref.get()).data();
  report(
    'fichar cierra FICHO aunque falte el id en el turno',
    cov?.isPresent === true
      && cov?.isAwaitingCoverageCheckIn === false
      && conv?.followUpClosedReason === 'FICHO'
      && conv?.delayAlertPending === false
      && conv?.reminderPending === false,
    `await=${cov?.isAwaitingCoverageCheckIn} reason=${conv?.followUpClosedReason}`,
  );

  const antesDelay = conv?.expectedArrivalAt?.toMillis?.() || 0;
  await runConvocadoFollowUp(db, ar(8, 11, 30));
  const novedades = await db.collection('novedades').where('empresaId', '==', EMP).get();
  const demorado = novedades.docs.some((d) => d.data().type === 'CONVOCADO_DEMORADO');
  report('el cron no avisa demorado si ya fichó', !demorado, demorado ? 'hay novedad' : '');

  const resp = await responderRecordatorioConvocadoShift(db, {
    convocatoriaId: convDoc.id,
    action: 'ON_WAY',
    etaMinutes: 10,
  });
  const convDespues = (await convDoc.ref.get()).data();
  report(
    'responder después de fichar se rechaza y no mueve la llegada',
    resp.success === false
      && resp.reason === 'Ya fichaste'
      && (convDespues?.expectedArrivalAt?.toMillis?.() || 0) === antesDelay
      && convDespues?.followUpClosedReason === 'FICHO',
    resp.reason || '',
  );

  const ayer = db.collection('convocatorias_cobertura').doc(id('ayer'));
  const llegadaAyer = ar(7, 11, 0);
  await ayer.set({
    empresaId: EMP,
    shiftId: id('tit_ayer'),
    candidateEmployeeId: lallana,
    candidateEmployeeName: 'LALLANA',
    status: 'ACCEPTED',
    type: 'REF',
    asignacionDirecta: true,
    followUpClosedAt: ar(7, 10, 50),
    followUpClosedReason: 'FICHO',
    expectedArrivalAt: llegadaAyer,
    delayAlertPending: false,
    startTime: ar(7, 10, 45),
    endTime: ar(7, 12, 0),
    gapEndAt: ar(7, 12, 0),
  });
  const respAyer = await responderRecordatorioConvocadoShift(db, {
    convocatoriaId: ayer.id,
    action: 'ON_WAY',
    etaMinutes: 15,
  });
  const ayerDespues = (await ayer.get()).data();
  report(
    'una convocatoria de ayer cerrada no se reescribe',
    respAyer.success === false
      && respAyer.reason === 'Ya fichaste'
      && ayerDespues?.expectedArrivalAt?.toMillis?.() === llegadaAyer.toMillis()
      && ayerDespues?.delayAlertPending === false,
    respAyer.reason || '',
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
