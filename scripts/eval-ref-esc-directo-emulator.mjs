/**
 * REF/ESC/RET: anticipada (>1 h) es turno planificado; urgente (≤1 h o ya empezado) es convocado.
 *
 * firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ref-esc "node scripts/eval-ref-esc-directo-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ref-esc' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { crearConvocatoriaDoc } = requireFn('./lib/coverage/convocatoriasCobertura.js');
const { recordConvocadoAcceptEta } = requireFn('./lib/coverage/convocadoAcceptEta.js');
const { runConvocadoFollowUp } = requireFn('./lib/attendance/convocadoFollowUp.js');
const { buildOpsCoverageDocId } = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const P = `refesc_${Date.now()}`;
const EMP = `${P}_emp`;
const id = (n) => `${P}_${n}`;
const ar = (h, min) => Timestamp.fromDate(new Date(`2026-10-07T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));

async function limpiar() {
  for (const col of ['turnos', 'convocatorias_cobertura', 'user_notifications', 'empleados', 'ausencias']) {
    const snap = await db.collection(col).where('empresaId', '==', EMP).get().catch(() => null);
    if (!snap) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }
  const notif = await db.collection('user_notifications').where('employeeId', '==', id('lallana')).get();
  if (!notif.empty) {
    const batch = db.batch();
    notif.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function main() {
  await limpiar();
  const obj = id('peaje');
  const otro = id('otro');
  const baez = id('baez');
  const lallana = id('lallana');
  const tit = id('tit_m');
  const ref = id('ref_lallana');

  await db.collection('empleados').doc(lallana).set({
    empresaId: EMP, uid: id('uid_lallana'), firstName: 'Laura', nombre: 'LALLANA Laura',
  });
  await db.collection('turnos').doc(tit).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: baez, employeeName: 'BAEZ', code: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0),
    status: 'ABSENT', isAbsent: true,
  });
  await db.collection('turnos').doc(ref).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: lallana, employeeName: 'LALLANA', code: 'REF', deploymentBand: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), status: 'PENDING',
  });

  const directa = await crearConvocatoriaDoc(db, {
    empresaId: EMP,
    shiftId: tit,
    objectiveId: obj,
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    clientId: id('cli'),
    clientName: 'Cliente',
    shiftCode: 'M',
    startTime: ar(10, 45),
    endTime: ar(12, 0),
    aptitudesRequeridas: [],
    type: 'REF',
    cascadeStep: 1,
    candidateEmployeeId: lallana,
    candidateEmployeeName: 'LALLANA',
    candidateShiftId: ref,
    createdBy: 'AUTO',
  }, { now: ar(8, 0) });
  const convs = await db.collection('convocatorias_cobertura').where('shiftId', '==', tit).get();
  const covId = buildOpsCoverageDocId(tit, lallana);
  const cov = (await db.collection('turnos').doc(covId).get()).data();
  const src = (await db.collection('turnos').doc(ref).get()).data();
  const avisos = await db.collection('user_notifications').where('employeeId', '==', lallana).get();
  const aviso = avisos.docs.map((d) => d.data()).find((n) => n.type === 'TURNO_ACTUALIZADO');
  report('caso 1: sin convocatoria', directa.startsWith('directa:') && convs.empty, directa);
  report(
    'caso 1: ops_cov M, ventana de titular, origen dado de baja',
    cov?.code === 'M'
      && cov?.coverageType === 'REF'
      && cov?.refEscAsignacionDirecta === true
      && cov?.origin === 'OPERATIONS_COVERAGE'
      && !cov?.assignedByConvocatoria
      && src?.isDeleted === true
      && src?.deletedReason === 'CONVERTIDO_EN_COBERTURA',
    `code=${cov?.code} del=${src?.isDeleted}`,
  );
  report(
    'caso 1: aviso informativo',
    aviso?.body === 'Tu turno fue actualizado a Turno Mañana (M) en Peaje 9 Norte · Puesto 1.'
      && aviso?.title === 'Turno actualizado',
    aviso?.body || '',
  );

  const tit2 = id('tit_otro');
  const ref2 = id('ref_otro');
  const guard2 = id('guard_otro');
  await db.collection('empleados').doc(guard2).set({ empresaId: EMP, firstName: 'Ana', nombre: 'OTRO Ana' });
  await db.collection('turnos').doc(tit2).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: baez, employeeName: 'BAEZ', code: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), status: 'ABSENT', isAbsent: true,
  });
  await db.collection('turnos').doc(ref2).set({
    empresaId: EMP, objectiveId: otro, objectiveName: 'Planta Sur', positionName: 'Puesto 1',
    employeeId: guard2, employeeName: 'OTRO', code: 'ESC', deploymentBand: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), status: 'PENDING',
  });
  const convId = await crearConvocatoriaDoc(db, {
    empresaId: EMP,
    shiftId: tit2,
    objectiveId: obj,
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    clientId: id('cli'),
    clientName: 'Cliente',
    shiftCode: 'M',
    startTime: ar(10, 45),
    endTime: ar(12, 0),
    aptitudesRequeridas: [],
    type: 'ESC',
    cascadeStep: 2,
    candidateEmployeeId: guard2,
    candidateEmployeeName: 'OTRO',
    candidateShiftId: ref2,
    createdBy: 'OPERADOR',
  }, { now: ar(10, 0) });
  const convDoc = await db.collection('convocatorias_cobertura').doc(convId).get();
  report('caso 2: pide aceptación', !convId.startsWith('directa:') && convDoc.exists && convDoc.data()?.status === 'PENDING', convId);

  await convDoc.ref.update({ status: 'ACCEPTED', respondedAt: ar(10, 0) });
  await recordConvocadoAcceptEta(db, convId, { now: ar(10, 0) });
  const aceptada = (await db.collection('convocatorias_cobertura').doc(convId).get()).data();
  report(
    'caso 2 urgente: pide aceptación y arma el recordatorio del convocado',
    aceptada?.status === 'ACCEPTED' && aceptada?.escenarioCobertura === 'URGENTE' && aceptada?.reminderPending === true,
    `pending=${aceptada?.reminderPending} escenario=${aceptada?.escenarioCobertura}`,
  );
  await runConvocadoFollowUp(db, ar(10, 0));
  const despues = (await db.collection('convocatorias_cobertura').doc(convId).get()).data();
  report('caso 2: el recordatorio no sale antes de los 2/3 del ETA', !despues?.reminderSentAt, String(despues?.reminderSentAt || ''));

  const reten = id('reten');
  await db.collection('empleados').doc(reten).set({
    empresaId: EMP, uid: id('uid_reten'), firstName: 'Laura', nombre: 'RETEN Laura',
    lat: -31.4, lng: -64.2,
  });
  const titRet = id('tit_ret');
  const ret = id('ret');
  await db.collection('turnos').doc(titRet).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    clientName: 'Cliente', employeeId: baez, code: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), isAbsent: true, status: 'ABSENT',
    lat: -31.4, lng: -64.2,
  });
  await db.collection('turnos').doc(ret).set({
    empresaId: EMP, objectiveId: obj, code: 'RET', employeeId: reten, employeeName: 'RETEN Laura',
    startTime: ar(10, 45), endTime: ar(12, 0), status: 'PENDING',
  });
  const retDirecta = await crearConvocatoriaDoc(db, {
    empresaId: EMP, shiftId: titRet, objectiveId: obj, objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1', clientId: id('cli'), clientName: 'Cliente', shiftCode: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), aptitudesRequeridas: [],
    type: 'RET', cascadeStep: 0, candidateEmployeeId: reten, candidateEmployeeName: 'RETEN Laura',
    candidateShiftId: ret, createdBy: 'AUTO',
  }, { now: ar(8, 0) });
  const retConvs = await db.collection('convocatorias_cobertura').where('shiftId', '==', titRet).get();
  const retPend = retConvs.docs.filter((d) => ['PENDING', 'ESCALATED'].includes(d.data().status));
  const retAceptada = retConvs.docs.find((d) => d.data().status === 'ACCEPTED' && d.data().asignacionDirecta === true);
  const retCov = (await db.collection('turnos').doc(buildOpsCoverageDocId(titRet, reten)).get()).data();
  const retSrc = (await db.collection('turnos').doc(ret).get()).data();
  const retAvisos = await db.collection('user_notifications').where('employeeId', '==', reten).get();
  const retAviso = retAvisos.docs.map((d) => d.data()).find((n) => n.type === 'TURNO_ASIGNADO');
  report(
    'RET anticipada (>1 h): directo, sin convocatoria',
    retDirecta.startsWith('directa:') && retConvs.empty && retPend.length === 0 && !retAceptada,
    retDirecta,
  );
  report(
    'RET anticipada: turno planificado, sin ETA de convocado',
    retCov?.code === 'M'
      && retCov?.escenarioCobertura === 'ANTICIPADA'
      && retCov?.coberturaAnticipada === true
      && retCov?.coberturaUrgente !== true
      && retCov?.etaMinutes == null
      && retSrc?.isDeleted === true
      && retSrc?.deletedReason === 'CONVERTIDO_EN_COBERTURA',
    `escenario=${retCov?.escenarioCobertura} eta=${retCov?.etaMinutes}`,
  );
  report(
    'RET anticipada: aviso hoy a las HH:MM',
    retAviso?.body === 'Laura, hoy a las 10:45 cubrís Cliente · Peaje 9 Norte · Puesto 1, M 10:45–12:00.',
    retAviso?.body || '',
  );

  const titRet2 = id('tit_ret_otro');
  const ret2 = id('ret_otro');
  const reten2 = id('reten2');
  await db.collection('empleados').doc(reten2).set({
    empresaId: EMP, firstName: 'Pedro', nombre: 'OTRO Pedro', lat: -31.5, lng: -64.25,
  });
  await db.collection('turnos').doc(titRet2).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: baez, code: 'M', startTime: ar(10, 45), endTime: ar(12, 0),
    isAbsent: true, status: 'ABSENT', lat: -31.42, lng: -64.18,
  });
  await db.collection('turnos').doc(ret2).set({
    empresaId: EMP, objectiveId: otro, code: 'RET', employeeId: reten2,
    startTime: ar(10, 45), endTime: ar(12, 0), status: 'PENDING',
  });
  const retOtro = await crearConvocatoriaDoc(db, {
    empresaId: EMP, shiftId: titRet2, objectiveId: obj, objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1', clientId: id('cli'), clientName: 'Cliente', shiftCode: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), aptitudesRequeridas: [],
    type: 'RET', cascadeStep: 0, candidateEmployeeId: reten2, candidateEmployeeName: 'OTRO Pedro',
    candidateShiftId: ret2, createdBy: 'AUTO',
  }, { now: ar(11, 0) });
  const otroConvs = await db.collection('convocatorias_cobertura').where('shiftId', '==', titRet2).get();
  const otroPend = otroConvs.docs.filter((d) => d.data().status === 'PENDING');
  const otroCov = (await db.collection('turnos').doc(buildOpsCoverageDocId(titRet2, reten2)).get()).data();
  const otroAviso = (await db.collection('user_notifications').where('employeeId', '==', reten2).get())
    .docs.map((d) => d.data()).find((n) => n.type === 'TURNO_ASIGNADO');
  report(
    'RET otro objetivo: directo, sin pedir aceptación',
    retOtro.startsWith('directa:') && otroPend.length === 0 && otroCov?.coberturaUrgente === true,
    retOtro,
  );
  report(
    'RET ya empezado: lo antes posible y fichada desde la asignación',
    otroAviso?.body === 'Pedro, se te asignó cubrir Cliente · Peaje 9 Norte · Puesto 1, M 10:45–12:00. Presentate lo antes posible.'
      && otroCov?.escenarioCobertura === 'URGENTE'
      && otroCov?.acceptedAt?.toMillis?.() === ar(11, 0).toMillis(),
    otroAviso?.body || '',
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
