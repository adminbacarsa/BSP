/**
 * REF/ESC mismo objetivo: asignación directa, sin convocatoria, aviso informativo.
 * Otro objetivo: convocatoria (pide aceptar). Hueco a más de 5 min: sin recordatorio.
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
  });
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
  });
  const convDoc = await db.collection('convocatorias_cobertura').doc(convId).get();
  report('caso 2: pide aceptación', !convId.startsWith('directa:') && convDoc.exists && convDoc.data()?.status === 'PENDING', convId);

  await convDoc.ref.update({ status: 'ACCEPTED', respondedAt: ar(8, 0) });
  await recordConvocadoAcceptEta(db, convId, { now: ar(8, 0) });
  const aceptada = (await db.collection('convocatorias_cobertura').doc(convId).get()).data();
  report(
    'caso 2: hueco lejos, sin recordatorio al aceptar',
    aceptada?.reminderPending === false && aceptada?.status === 'ACCEPTED',
    `pending=${aceptada?.reminderPending} eta=${aceptada?.etaMinutes}`,
  );
  await runConvocadoFollowUp(db, ar(8, 30));
  const despues = (await db.collection('convocatorias_cobertura').doc(convId).get()).data();
  report('caso 2: el cron no manda ¿Seguís en camino? antes de T−5', !despues?.reminderSentAt, String(despues?.reminderSentAt || ''));

  const titRet = id('tit_ret');
  const ret = id('ret');
  await db.collection('turnos').doc(titRet).set({
    empresaId: EMP, objectiveId: obj, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1',
    employeeId: baez, code: 'M', startTime: ar(10, 45), endTime: ar(12, 0), isAbsent: true,
  });
  await db.collection('turnos').doc(ret).set({
    empresaId: EMP, objectiveId: obj, code: 'RET', employeeId: id('reten'),
    startTime: ar(10, 45), endTime: ar(12, 0),
  });
  const retConv = await crearConvocatoriaDoc(db, {
    empresaId: EMP, shiftId: titRet, objectiveId: obj, objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1', clientId: id('cli'), clientName: 'Cliente', shiftCode: 'M',
    startTime: ar(10, 45), endTime: ar(12, 0), aptitudesRequeridas: [],
    type: 'RET', cascadeStep: 0, candidateEmployeeId: id('reten'), candidateEmployeeName: 'RETEN',
    candidateShiftId: ret, createdBy: 'AUTO',
  });
  report('RET sigue convocando', !retConv.startsWith('directa:'), retConv);

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
