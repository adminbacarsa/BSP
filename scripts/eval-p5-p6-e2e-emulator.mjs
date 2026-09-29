/**
 * P5+P6 convocado. Emulador aislado (no el lab :8080).
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-p5p6 "node scripts/eval-p5-p6-e2e-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-p5p6';
admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { recordConvocadoAcceptEta, responderRecordatorioConvocadoShift } = requireFn('./lib/coverage/convocadoAcceptEta.js');
const { runConvocadoFollowUp } = requireFn('./lib/attendance/convocadoFollowUp.js');
const { runConvocadoAbsentPass } = requireFn('./lib/attendance/convocadoAbsentPass.js');
const { buildOpsCoverageDocId } = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const HOME = { lat: -34.6037, lng: -58.3816 };
const SITE = { lat: -34.4237, lng: -58.3816 };

async function eventsOf(id) {
  const snap = await db.collection('convocatorias_cobertura').doc(id).collection('eventos').get();
  return snap.docs.map((d) => d.data().type);
}

async function main() {
  const extWin = evaluateServerCheckInWindow(
    {
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'EXTEND',
      coverageHoursOnSource: true,
      startTime: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      endTime: Timestamp.fromMillis(Date.now() + 4 * 3600000),
      acceptedAt: Timestamp.fromMillis(Date.now() - 30 * 60 * 1000),
    },
    Date.now(),
  );
  report('EXT no ficha', extWin.rejectCode === 'EXT_NO_CHECKIN', extWin.rejectCode || '');

  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const gapStart = Timestamp.fromMillis(nowMs - 20 * 60 * 1000);
  const gapEnd = Timestamp.fromMillis(nowMs + 6 * 3600000);
  const acceptedAt = Timestamp.fromMillis(nowMs - 50 * 60 * 1000);

  const emp = 'p5_ret_e';
  const obj = 'p5_ret_obj';
  const tit = 'p5_ret_tit';
  const outId = 'p5_ret_out';
  const convId = 'p5_ret_conv';
  const covId = buildOpsCoverageDocId(tit, emp);

  await db.collection('empleados').doc(emp).set({
    nombre: 'Perez, Juan',
    employeeName: 'Perez, Juan',
    lat: HOME.lat,
    lng: HOME.lng,
    empresaId: 'p5_emp',
  });
  await db.collection('turnos').doc(tit).set({
    empresaId: 'p5_emp',
    objectiveId: obj,
    objectiveName: 'Peaje',
    positionName: 'Puesto 1',
    code: 'T',
    employeeId: 'titular',
    startTime: gapStart,
    endTime: gapEnd,
    lat: SITE.lat,
    lng: SITE.lng,
    isAbsent: true,
    status: 'ABSENT',
  });
  await db.collection('turnos').doc(outId).set({
    empresaId: 'p5_emp',
    objectiveId: obj,
    positionName: 'Puesto 1',
    code: 'M',
    employeeId: 'saliente',
    employeeName: 'Baez',
    startTime: Timestamp.fromMillis(nowMs - 8 * 3600000),
    endTime: gapStart,
    isPresent: true,
    isCompleted: false,
    isRetention: true,
    status: 'PRESENT',
    realStartTime: Timestamp.fromMillis(nowMs - 7 * 3600000),
  });
  await db.collection('turnos').doc(covId).set({
    empresaId: 'p5_emp',
    objectiveId: obj,
    objectiveName: 'Peaje',
    positionName: 'Puesto 1',
    code: 'T',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'RET',
    employeeId: emp,
    employeeName: 'Perez, Juan',
    absenceShiftId: tit,
    startTime: gapStart,
    endTime: gapEnd,
    acceptedAt,
    status: 'PENDING',
    isPresent: false,
    assignedByConvocatoria: convId,
    coverageConvocatoriaId: convId,
  });
  await db.collection('convocatorias_cobertura').doc(convId).set({
    empresaId: 'p5_emp',
    shiftId: tit,
    objectiveId: obj,
    objectiveName: 'Peaje',
    type: 'RET',
    status: 'ACCEPTED',
    candidateEmployeeId: emp,
    candidateEmployeeName: 'Perez, Juan',
    respondedAt: acceptedAt,
  });

  const eta = await recordConvocadoAcceptEta(db, convId, { now: acceptedAt });
  const conv = (await db.collection('convocatorias_cobertura').doc(convId).get()).data();
  const reminderMs = conv.reminderAt.toMillis();
  report(
    'RET desde casa',
    eta.originSource === 'DOMICILIO' && eta.etaMinutes >= 60 && eta.etaMinutes <= 80 && conv.expectedArrivalAt,
    `src=${eta.originSource} eta=${eta.etaMinutes}`,
  );

  await runConvocadoFollowUp(db, Timestamp.fromMillis(reminderMs + 1000));
  const afterRem = (await db.collection('convocatorias_cobertura').doc(convId).get()).data();
  const covRem = (await db.collection('turnos').doc(covId).get()).data();
  const typesRem = await eventsOf(convId);
  report(
    'recordatorio 2/3',
    !!afterRem.reminderSentAt && !!covRem.convocadoReminderSentAt && typesRem.includes('RECORDATORIO') && typesRem.includes('ACEPTADA'),
    typesRem.join(','),
  );

  await registrarPresencia(db, {
    shiftId: covId,
    empId: emp,
    source: 'PORTAL_GPS',
    recordedAt: new Date(nowMs).toISOString(),
  });
  const punched = (await db.collection('turnos').doc(covId).get()).data();
  const outgoing = (await db.collection('turnos').doc(outId).get()).data();
  const typesPunch = await eventsOf(convId);
  const punchMs = punched.realStartTime?.toMillis?.() ?? 0;
  report(
    'ficha y libera retenido',
    punched.isPresent === true
      && punched.isLate !== true
      && (punched.lateMinutes || 0) === 0
      && Math.abs(punchMs - nowMs) < 5000
      && outgoing.isRetention === false
      && outgoing.isCompleted === true
      && typesPunch.includes('FICHO'),
    `late=${punched.lateMinutes} ret=${outgoing.isRetention} done=${outgoing.isCompleted} ${typesPunch.join(',')}`,
  );

  const escEmp = 'p5_esc_e';
  const escObj = 'p5_esc_obj';
  const escTit = 'p5_esc_tit';
  const escSrc = 'p5_esc_src';
  const escConv = 'p5_esc_conv';
  await db.collection('empleados').doc(escEmp).set({ lat: HOME.lat, lng: HOME.lng, employeeName: 'Escuela' });
  await db.collection('turnos').doc(escTit).set({
    objectiveId: escObj, lat: SITE.lat, lng: SITE.lng, code: 'M', positionName: 'Puesto 1',
  });
  await db.collection('turnos').doc(escSrc).set({
    objectiveId: escObj, code: 'ESC', employeeId: escEmp, positionName: 'Puesto 1',
  });
  await db.collection('convocatorias_cobertura').doc(escConv).set({
    empresaId: 'p5_emp',
    shiftId: escTit,
    objectiveId: escObj,
    type: 'ESC',
    status: 'ACCEPTED',
    candidateEmployeeId: escEmp,
    candidateShiftId: escSrc,
    respondedAt: now,
  });
  const escEta = await recordConvocadoAcceptEta(db, escConv, { now });
  report('ESC mismo objetivo', escEta.etaMinutes === 5 && escEta.originSource === 'DOMICILIO', `eta=${escEta.etaMinutes} src=${escEta.originSource}`);

  const ftConv = 'p5_ft_conv';
  const ftEmp = 'p5_ft_e';
  const ftTit = 'p5_ft_tit';
  const ftCov = buildOpsCoverageDocId(ftTit, ftEmp);
  const expected = Timestamp.fromMillis(nowMs - 20 * 60 * 1000);
  await db.collection('convocatorias_cobertura').doc(ftConv).set({
    empresaId: 'p5_emp',
    shiftId: ftTit,
    objectiveId: 'p5_ft_obj',
    type: 'FT',
    status: 'ACCEPTED',
    candidateEmployeeId: ftEmp,
    candidateEmployeeName: 'Franco',
    expectedArrivalAt: expected,
    reminderAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
  });
  await db.collection('turnos').doc(ftCov).set({
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'FT',
    employeeId: ftEmp,
    absenceShiftId: ftTit,
    isPresent: false,
    isAbsent: false,
    status: 'PENDING',
    empresaId: 'p5_emp',
  });
  await runConvocadoFollowUp(db, now);
  const absentPass = await runConvocadoAbsentPass(db, now, () => true);
  const ftShift = (await db.collection('turnos').doc(ftCov).get()).data();
  const novedades = await db.collection('novedades').where('convocatoriaId', '==', ftConv).get();
  const demora = novedades.docs.map((d) => d.data().type);
  const ftTypes = await eventsOf(ftConv);
  report(
    'FT demorado sin AA',
    absentPass === 0
      && ftShift.isAbsent !== true
      && ftShift.convocadoDemorado === true
      && demora.includes('CONVOCADO_DEMORADO')
      && ftTypes.includes('DEMORADO'),
    `pass=${absentPass} abs=${ftShift.isAbsent} ${demora.join(',')} ${ftTypes.join(',')}`,
  );

  const reply = await responderRecordatorioConvocadoShift(db, {
    convocatoriaId: ftConv,
    action: 'PROBLEM',
    note: 'Colectivo cortado',
  });
  const problema = await db.collection('novedades').where('convocatoriaId', '==', ftConv).get();
  report(
    'problema convocado',
    reply.success === true && problema.docs.some((d) => d.data().type === 'PROBLEMA_CONVOCADO' && String(d.data().description).includes('Colectivo')),
    reply.reason || 'ok',
  );

  const advTit = 'p5_adv_tit';
  const advEmp = 'p5_adv_e';
  const advCov = buildOpsCoverageDocId(advTit, advEmp);
  const extShift = 'p5_ext_shift';
  const extConv = 'p5_ext_conv';
  await db.collection('turnos').doc(extShift).set({
    employeeId: 'extendido',
    employeeName: 'Extendido',
    isExtended: true,
    isPresent: true,
    isCompleted: false,
    isRetention: false,
    status: 'PRESENT',
    code: 'M',
    origin: 'PLANIFICADOR',
  });
  await db.collection('convocatorias_cobertura').doc(extConv).set({
    shiftId: advTit,
    type: 'EXTEND',
    status: 'ACCEPTED',
    extendShiftId: extShift,
    candidateEmployeeId: 'extendido',
  });
  await db.collection('turnos').doc(advCov).set({
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'ADVANCE',
    coverageHoursOnSource: true,
    employeeId: advEmp,
    employeeName: 'Adelantado',
    absenceShiftId: advTit,
    objectiveId: 'p5_adv_obj',
    positionName: 'Puesto 1',
    code: 'T',
    startTime: gapStart,
    endTime: gapEnd,
    acceptedAt,
    status: 'PENDING',
    isPresent: false,
    empresaId: 'p5_emp',
  });
  await registrarPresencia(db, {
    shiftId: advCov,
    empId: advEmp,
    source: 'PORTAL_GPS',
    recordedAt: new Date(nowMs).toISOString(),
  });
  const adv = (await db.collection('turnos').doc(advCov).get()).data();
  const ext = (await db.collection('turnos').doc(extShift).get()).data();
  report(
    'ADV libera al EXT',
    adv.isPresent === true
      && (adv.lateMinutes || 0) === 0
      && ext.isExtended === false
      && ext.isCompleted === true
      && ext.completionReason === 'RELEVO_ADVANCE',
    `ext=${ext.isExtended} done=${ext.isCompleted} reason=${ext.completionReason}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
