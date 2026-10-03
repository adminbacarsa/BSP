/**
 * P8 eventos en el CC. Emulador aislado (no el lab :8080).
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-p8 "node scripts/eval-p8-eventos-cc-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-p8' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { resolveCheckInPayClock } = requireFn('./lib/fichajes/checkInPay.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
const { retainOutgoingForGap } = requireFn('./lib/coverage/coverageRetention.js');
const { iniciarCascadaCobertura } = requireFn('./lib/coverage/convocatoriasCobertura.js');
const { applyCoverage } = requireFn('./lib/coverage/syncAusenciaCobertura.js');
const { runShiftArrivalNotices } = requireFn('./lib/attendance/arrivalNotices.js');
const { loadCentroControlState } = requireFn('./lib/ops/centroControlGuard.js');
const { aplicarEventualNoSePresento } = requireFn('./lib/eventuales/eventualNoSePresento.js');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

async function main() {
  const start = Date.parse('2026-09-29T18:00:00-03:00');
  const end = Date.parse('2026-09-29T23:00:00-03:00');
  const ev = {
    code: 'EV',
    origin: 'EVENTO',
    eventoId: 'ev1',
    servicioNombre: 'Plaza',
    startTime: Timestamp.fromMillis(start),
    endTime: Timestamp.fromMillis(end),
  };
  const onTime = evaluateServerCheckInWindow(ev, start + 2 * 60 * 1000);
  const payOn = resolveCheckInPayClock({ nowMs: start + 2 * 60 * 1000, plannedStartMs: start, windowLateMinutes: onTime.lateMinutes });
  report('EV a horario', onTime.allowed === true && payOn.realStartMs === start && payOn.isLate === false, `late=${payOn.lateMinutes}`);
  const lateAt = start + 10 * 60 * 1000;
  const lateWin = evaluateServerCheckInWindow(ev, lateAt);
  const payLate = resolveCheckInPayClock({ nowMs: lateAt, plannedStartMs: start, windowLateMinutes: lateWin.lateMinutes });
  report('EV tarde', lateWin.allowed === true && lateWin.lateNoNotice === true && payLate.realStartMs === lateAt && payLate.isLate === true, `min=${payLate.lateMinutes}`);

  const empresaId = 'p8_emp';
  const objectiveId = 'p8_obj';
  await db.collection('empresas').doc(empresaId).set({ centroControlEnabled: true, modoDemoEnabled: false });

  const punchId = 'p8_punch';
  await db.collection('turnos').doc(punchId).set({
    ...ev,
    empresaId,
    objectiveId,
    objectiveName: 'Plaza',
    positionName: 'Acceso',
    servicioNombre: 'Acceso norte',
    employeeId: 'p8_guard',
    employeeName: 'Gomez, Ana',
    status: 'PENDING',
    isPresent: false,
  });
  await registrarPresencia(db, {
    shiftId: punchId,
    empId: 'p8_guard',
    source: 'PORTAL_GPS',
    recordedAt: new Date(start + 3 * 60 * 1000).toISOString(),
  });
  const punched = (await db.collection('turnos').doc(punchId).get()).data();
  report(
    'fichada EV paga el plan',
    punched.isPresent === true && punched.realStartTime.toMillis() === start && punched.isLate !== true,
    `late=${punched.isLate}`,
  );

  const absId = 'p8_abs';
  const absStart = Timestamp.fromMillis(Date.now() - 40 * 60 * 1000);
  const absEnd = Timestamp.fromMillis(Date.now() + 4 * 3600000);
  await db.collection('turnos').doc(absId).set({
    empresaId,
    objectiveId,
    objectiveName: 'Plaza',
    positionName: 'Acceso',
    code: 'EV',
    origin: 'EVENTO',
    eventoId: 'ev_noche',
    eventoNombre: 'Los Pumas',
    servicioId: 'srv1',
    servicioNombre: 'Molinete',
    employeeId: 'p8_ausente',
    employeeName: 'Perez, Luis',
    startTime: absStart,
    endTime: absEnd,
    status: 'PENDING',
    isPresent: false,
  });
  await db.collection('turnos').doc('p8_ret').set({
    empresaId, objectiveId, positionName: 'Acceso', code: 'RET',
    employeeId: 'p8_ret_e', employeeName: 'Retenido',
    startTime: absStart, endTime: absEnd, status: 'PENDING', isPresent: false,
  });
  await db.collection('turnos').doc('p8_ref').set({
    empresaId, objectiveId, positionName: 'Acceso', code: 'REF',
    employeeId: 'p8_ref_e', employeeName: 'Refuerzo',
    startTime: absStart, endTime: absEnd, status: 'PENDING', isPresent: false,
  });
  await db.collection('turnos').doc('p8_out').set({
    empresaId, objectiveId, positionName: 'Acceso', code: 'M',
    employeeId: 'p8_out_e', employeeName: 'Saliente',
    startTime: Timestamp.fromMillis(Date.now() - 8 * 3600000),
    endTime: absStart, isPresent: true, isRetention: false, status: 'PRESENT',
  });

  const marked = await markShiftAbsent(db, absId, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
  const aus = await db.collection('ausencias').where('shiftId', '==', absId).get();
  const nov = await db.collection('novedades').where('shiftId', '==', absId).where('type', '==', 'AUSENCIA_AUTO').get();
  const vacantes = await db.collection('turnos').where('objectiveId', '==', objectiveId).where('employeeId', '==', 'VACANTE').get();
  const ausData = aus.docs[0]?.data();
  report(
    'ausencia EV sin vacante SLA',
    marked.applied === true
      && ausData?.absenceType === 'AA'
      && ausData?.eventoId === 'ev_noche'
      && ausData?.servicioNombre === 'Molinete'
      && ausData?.eventGap === true
      && nov.size === 1
      && nov.docs[0].data().eventoId === 'ev_noche'
      && vacantes.size === 0,
    `aus=${aus.size} nov=${nov.size} vac=${vacantes.size}`,
  );

  const retained = await retainOutgoingForGap(db, { id: absId, ...(await db.collection('turnos').doc(absId).get()).data() });
  const out = (await db.collection('turnos').doc('p8_out').get()).data();
  report('no retiene', retained.skippedReason === 'EVENTO_SIN_CONTINUIDAD' && out.isRetention !== true, retained.skippedReason || '');

  await iniciarCascadaCobertura(db, {
    id: absId,
    empresaId,
    objectiveId,
    objectiveName: 'Plaza',
    positionName: 'Acceso',
    code: 'EV',
    startTime: absStart,
    endTime: absEnd,
  }, 'AUTO');
  const convs = await db.collection('convocatorias_cobertura').where('shiftId', '==', absId).get();
  const types = convs.docs.map((d) => d.data().type);
  report('cascada del evento', types.includes('REF') && !types.includes('RET'), types.join(',') || 'vacia');

  const batch = db.batch();
  const covId = await applyCoverage(db, batch, {
    titularShiftId: absId,
    candidateEmployeeId: 'p8_ref_e',
    candidateEmployeeName: 'Refuerzo',
    sourceShiftId: 'p8_ref',
    coverageType: 'REF',
    resolvedBy: 'AUTO',
    empresaId,
    titularCloseMode: 'FULL',
  });
  await batch.commit();
  const cov = (await db.collection('turnos').doc(covId).get()).data();
  report(
    'cobertura escribe EV',
    cov?.code === 'EV' && cov?.type === 'Evento' && cov?.origin === 'EVENTO' && cov?.eventoId === 'ev_noche' && cov?.servicioNombre === 'Molinete' && cov?.positionName === 'Molinete' && cov?.draft === false,
    `code=${cov?.code} ev=${cov?.eventoId}`,
  );

  const now = Timestamp.now();
  const noticeStart = Timestamp.fromMillis(now.toMillis() + 3 * 60 * 1000);
  const noticeEnd = Timestamp.fromMillis(now.toMillis() + 5 * 3600000);
  await db.collection('turnos').doc('p8_notice').set({
    empresaId, objectiveId: 'p8_fuera', objectiveName: 'Show', positionName: 'Puerta',
    code: 'EV', origin: 'EVENTO', eventoId: 'evn', servicioNombre: 'Puerta',
    employeeId: 'p8_n', employeeName: 'N',
    startTime: noticeStart, endTime: noticeEnd, status: 'PENDING', isPresent: false,
  });
  await db.collection('turnos').doc('p8_puesto').set({
    empresaId, objectiveId: 'p8_fuera', objectiveName: 'Show', positionName: 'Puesto 1',
    code: 'M', origin: 'PLANIFICADOR',
    employeeId: 'p8_m', employeeName: 'M',
    startTime: noticeStart, endTime: noticeEnd, status: 'PENDING', isPresent: false,
  });
  const cc = await loadCentroControlState(db);
  await runShiftArrivalNotices(db, now, cc);
  const evNotice = (await db.collection('turnos').doc('p8_notice').get()).data();
  const puesto = (await db.collection('turnos').doc('p8_puesto').get()).data();
  report(
    'aviso T-5 solo el evento',
    !!evNotice.preStartArrivalNoticeAt && !puesto.preStartArrivalNoticeAt,
    `ev=${!!evNotice.preStartArrivalNoticeAt} puesto=${!!puesto.preStartArrivalNoticeAt}`,
  );

  // Auditoría 02/10: la falta del eventual relanzaba la cascada aunque la sala estuviera en Manual.
  const evFalta = (id, employeeId, cuil) => ({
    empresaId, objectiveId, objectiveName: 'Plaza', positionName: 'Molinete',
    code: 'EV', origin: 'EVENTO', eventoId: 'ev_noche', eventoNombre: 'Los Pumas', servicioId: 'srv1', servicioNombre: 'Molinete',
    employeeId, employeeName: `Eventual ${id}`, esEventual: true, bolsaCuil: cuil, scheduleDate: '2026-10-02',
    startTime: absStart, endTime: absEnd, status: 'PENDING', isPresent: false, isAbsent: true,
  });
  await db.collection('turnos').doc('p8_ev_manual').set(evFalta('p8_ev_manual', 'p8_evm', '20111111110'));
  await db.collection('sesiones_operador').doc('p8_sala').set({
    empresaId, status: 'ACTIVO', role: 'PILOTO', uid: 'operador', expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
  });
  const manual = await aplicarEventualNoSePresento(db, { shiftId: 'p8_ev_manual', aviso: false, actorUid: 'SYSTEM_SCHEDULER' });
  const evManual = (await db.collection('turnos').doc('p8_ev_manual').get()).data();
  const convManual = await db.collection('convocatorias_cobertura').where('shiftId', '==', 'p8_ev_manual').get();
  report(
    'falta eventual en Manual no cascada',
    manual.reconvocado === false && evManual.cascadeSkippedReason === 'MANUAL' && !evManual.cascadeLockAt && convManual.size === 0
      && evManual.pagaJornada === false && evManual.noSePresento === true,
    `reconvocado=${manual.reconvocado} skip=${evManual.cascadeSkippedReason} conv=${convManual.size}`,
  );

  await db.collection('sesiones_operador').doc('p8_sala').update({ status: 'CERRADA' });
  await db.collection('turnos').doc('p8_ev_auto').set(evFalta('p8_ev_auto', 'p8_eva', '20222222220'));
  const auto = await aplicarEventualNoSePresento(db, { shiftId: 'p8_ev_auto', aviso: false, actorUid: 'SYSTEM_SCHEDULER' });
  const evAuto = (await db.collection('turnos').doc('p8_ev_auto').get()).data();
  report(
    'falta eventual en Auto cascada',
    auto.reconvocado === true && !evAuto.cascadeSkippedReason && !!evAuto.cascadeLockAt,
    `reconvocado=${auto.reconvocado} lock=${!!evAuto.cascadeLockAt}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
