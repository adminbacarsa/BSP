/**
 * Tarjeta de retención: sale del turno, el cierre marca la notificación
 * y el acuse queda en el turno + audit_logs (también en vista previa SA).
 *
 * Emulador aislado (no el lab :8080):
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-retencion-tarjeta "node scripts/eval-retencion-tarjeta-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-retencion-tarjeta' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { cerrarAvisosRetencionDelTurno } = requireFn('./lib/ops/cerrarAvisosRetencion.js');
const { acusarRetencion } = requireFn('./lib/ops/acusarRetencion.js');
const {
  turnoMuestraTarjetaRetencion,
  textoTarjetaRetencion,
  MOTIVO_RETENCION_TERMINADA,
} = requireFn('./lib/ops/retencionTarjetaPura.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const PREFIX = `ret_${Date.now()}`;
const EMP = `${PREFIX}_emp`;
const id = (name) => `${PREFIX}_${name}`;
const E_FERRERO = id('e_ferrero');
const UID_FERRERO = id('uid_ferrero');
const UID_SA = id('uid_sa');
const UID_OTRO = id('uid_otro');
const T_RET = id('t_ret');
const T_HOY = id('t_hoy');
const T_AYER = id('t_ayer');

const ar = (ymd, hm) => Timestamp.fromDate(new Date(`${ymd}T${hm}:00-03:00`));
const NOW = ar('2026-10-07', '15:10').toMillis();

async function borrarPropios() {
  for (const col of ['turnos', 'empleados', 'user_notifications', 'audit_logs']) {
    const snap = await db.collection(col).where('empresaId', '==', EMP).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  const emps = await db.collection('empleados').where('uid', 'in', [UID_FERRERO, UID_OTRO]).get();
  if (!emps.empty) {
    const batch = db.batch();
    emps.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

const base = {
  empresaId: EMP,
  objectiveName: 'Peaje 9 Norte',
  positionName: 'Puesto 2',
  employeeId: E_FERRERO,
  employeeName: 'FERRERO Kevin',
};

await borrarPropios();
await db.collection('empleados').doc(E_FERRERO).set({
  empresaId: EMP,
  uid: UID_FERRERO,
  firstName: 'Kevin',
  lastName: 'Ferrero',
  nombre: 'FERRERO Kevin',
});
await db.collection('empleados').doc(id('e_otro')).set({
  empresaId: EMP,
  uid: UID_OTRO,
  nombre: 'OTRO',
});

const vivo = {
  ...base,
  isRetention: true,
  isPresent: true,
  isCompleted: false,
  status: 'PRESENT',
  startTime: ar('2026-10-07', '11:30'),
  checkInAt: ar('2026-10-07', '11:30'),
  endTime: ar('2026-10-07', '15:15'),
  retentionStartedAt: ar('2026-10-07', '15:00'),
  lateReliefIncomingName: 'BRIZUELA',
  lateReliefEtaAt: ar('2026-10-07', '15:45'),
};
await db.collection('turnos').doc(T_RET).set(vivo);
await db.collection('turnos').doc(T_HOY).set({
  ...base,
  code: 'M',
  isPresent: false,
  isRetention: false,
  isCompleted: false,
  startTime: ar('2026-10-07', '11:30'),
  endTime: ar('2026-10-07', '15:15'),
});
await db.collection('turnos').doc(T_AYER).set({
  ...base,
  isRetention: true,
  isPresent: true,
  isCompleted: true,
  status: 'COMPLETED',
  startTime: ar('2026-10-06', '11:30'),
  endTime: ar('2026-10-06', '15:15'),
  realEndTime: ar('2026-10-06', '15:15'),
});

const nAuto = db.collection('user_notifications').doc(id('n_auto'));
const nAviso = db.collection('user_notifications').doc(id('n_aviso'));
await nAuto.set({
  empresaId: EMP,
  employeeId: E_FERRERO,
  type: 'RETENCION_AUTO',
  turnoId: T_RET,
  read: false,
  title: '⛔ Quedás retenido',
  body: 'vieja sin shiftId',
  createdAt: ar('2026-10-07', '15:00'),
});
await nAviso.set({
  empresaId: EMP,
  employeeId: E_FERRERO,
  type: 'RETENCION_AVISO',
  shiftId: T_RET,
  turnoId: T_RET,
  read: false,
  title: '⛔ Quedás retenido',
  body: 'BRIZUELA llega cerca de las 15:45',
  createdAt: ar('2026-10-07', '15:01'),
});

const snapVivo = (await db.collection('turnos').doc(T_RET).get()).data();
const snapHoy = (await db.collection('turnos').doc(T_HOY).get()).data();
const snapAyer = (await db.collection('turnos').doc(T_AYER).get()).data();
report('retención viva muestra tarjeta', turnoMuestraTarjetaRetencion(snapVivo, NOW) === true);
report('M de hoy sin empezar no', turnoMuestraTarjetaRetencion(snapHoy, ar('2026-10-07', '11:29').toMillis()) === false);
report('ayer COMPLETED no', turnoMuestraTarjetaRetencion(snapAyer, NOW) === false);
const texto = textoTarjetaRetencion(snapVivo);
report('texto con relevo y tope', /BRIZUELA/.test(texto) && /15:45/.test(texto) && /tope 00:29/.test(texto), texto);

await db.collection('turnos').doc(T_RET).update({
  isRetention: false,
  isCompleted: true,
  status: 'COMPLETED',
  realEndTime: ar('2026-10-07', '15:20'),
});
const closedN = await cerrarAvisosRetencionDelTurno(db, T_RET);
const afterClose = (await db.collection('turnos').doc(T_RET).get()).data();
const auto = (await nAuto.get()).data();
const aviso = (await nAviso.get()).data();
report('cierre marca las dos', closedN === 2, String(closedN));
report('tarjeta desaparece al cerrar', turnoMuestraTarjetaRetencion(afterClose, ar('2026-10-07', '15:21').toMillis()) === false);
report(
  'notif sin shiftId cerrada por turnoId',
  auto.read === true && auto.closedMotivo === MOTIVO_RETENCION_TERMINADA && !!auto.closedAt,
);
report(
  'notif con shiftId cerrada',
  aviso.read === true && aviso.closedMotivo === MOTIVO_RETENCION_TERMINADA && !!aviso.closedAt,
);

await db.collection('turnos').doc(T_RET).set(vivo);
const acuse = await acusarRetencion(db, {
  shiftId: T_RET,
  authUid: UID_FERRERO,
  actorName: 'FERRERO Kevin',
  role: 'GUARDIA',
});
const turnoAcuse = (await db.collection('turnos').doc(T_RET).get()).data();
const audits = await db.collection('audit_logs').where('shiftId', '==', T_RET).where('action', '==', 'RETENCION_ACUSE').get();
report('acuse del guardia', acuse.ok === true && acuse.already === false && acuse.preview === false);
report('retencionAcuseAt en el turno', !!turnoAcuse.retencionAcuseAt);
report('audit_logs del acuse', audits.size === 1 && audits.docs[0].data().modo === 'app', String(audits.size));

const otra = await acusarRetencion(db, {
  shiftId: T_RET,
  authUid: UID_FERRERO,
  actorName: 'FERRERO Kevin',
  role: 'GUARDIA',
});
const turno2 = (await db.collection('turnos').doc(T_RET).get()).data();
report('el segundo acuse no pisa la hora', otra.ok === true && otra.already === true && turno2.retencionAcuseAt.isEqual(turnoAcuse.retencionAcuseAt));

await db.collection('turnos').doc(T_RET).set(vivo);
const preview = await acusarRetencion(db, {
  shiftId: T_RET,
  authUid: UID_SA,
  actorName: 'Mauro',
  role: 'SUPERADMIN',
  asEmployeeId: E_FERRERO,
});
const auditsSa = await db.collection('audit_logs').where('shiftId', '==', T_RET).where('modo', '==', 'preview').get();
report('acuse en vista previa', preview.ok === true && preview.preview === true);
report('audit actor SA modo preview', auditsSa.size === 1 && auditsSa.docs[0].data().actorId === UID_SA);

const ajeno = await acusarRetencion(db, {
  shiftId: T_RET,
  authUid: UID_OTRO,
  actorName: 'Otro',
  role: 'GUARDIA',
});
const sinAs = await acusarRetencion(db, {
  shiftId: T_RET,
  authUid: UID_SA,
  actorName: 'Mauro',
  role: 'SUPERADMIN',
});
report('otro guardia no acusa', ajeno.ok === false && ajeno.reason === 'NO_ES_TUYO');
report('SA sin asEmployeeId no acusa', sinAs.ok === false && sinAs.reason === 'NO_ES_TUYO');

await db.collection('turnos').doc(T_RET).update({
  isCompleted: true,
  status: 'COMPLETED',
  realEndTime: ar('2026-10-07', '15:20'),
  isRetention: false,
});
const tarde = await acusarRetencion(db, {
  shiftId: T_RET,
  authUid: UID_FERRERO,
  actorName: 'FERRERO Kevin',
  role: 'GUARDIA',
});
report('acuse de turno cerrado rechazado', tarde.ok === false && tarde.reason === 'RETENCION_CERRADA');

await borrarPropios();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length}`);
if (failed.length) process.exit(1);
