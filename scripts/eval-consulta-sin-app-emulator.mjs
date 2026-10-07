/**
 * La consulta se notifica por la bandeja aunque no tengan la app.
 * Sin uid ni mail → sigue ABIERTA, invitación PENDIENTE y user_notifications.
 * Uno con token y otro sin → «Consultados: 2 · 1 con aviso push».
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-consulta-sin-app "node scripts/eval-consulta-sin-app-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-consulta-sin-app';
admin.initializeApp({ projectId });
const db = admin.firestore();

const { crearConsultaDisponibilidad } = requireFn('./lib/eventuales/consultaDisponibilidad.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'csa_emp';
const PLANNER = { auth: { uid: 'uid-plan', token: { role: 'SuperAdmin', email: 'plan@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const SIN = { cuil: '20911111116', nombre: 'QUIROGA PEREZ' };
const CON = { cuil: '20822222223', nombre: 'SOSA, Eva', uid: 'uid-sosa' };
const FECHA = '2026-11-20';

function bolsa(p, extra = {}) {
  return {
    cuil: p.cuil, nombre: p.nombre, uid: p.uid || '', disponibilidad: 'DISPONIBLE', empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    mail: '', telefono: '3510000000', domicilio: 'Cordoba',
    marcos: { [EMP]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } },
    status: 'ACTIVE', ...extra,
  };
}
function pedido(cuils, fecha = FECHA) {
  return {
    empresaId: EMP, cuils, lugares: 1, venceMinutos: 120,
    objectiveName: 'Peaje', positionName: 'Puesto 1', clientName: 'Norte',
    jornadas: [{ fecha, horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M' }],
  };
}
function ts(iso) {
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'Consulta SA', status: 'ACTIVE' });
  await db.collection('eventuales_bolsa').doc(SIN.cuil).set(bolsa(SIN));

  const sola = await intentar(() => crearConsultaDisponibilidad.run(pedido([SIN.cuil]), PLANNER));
  const solaId = sola.value?.consultaId;
  const solaDoc = solaId ? (await db.collection('consultas_disponibilidad').doc(solaId).get()).data() : null;
  const solaInv = solaId ? (await db.collection('consultas_disponibilidad_invitaciones').doc(`${solaId}_${SIN.cuil}`).get()).data() : null;
  const novedades = await db.collection('novedades').where('empresaId', '==', EMP).get();
  const aviso = novedades.docs.some((d) => d.data().type === 'CONSULTA_DISPONIBILIDAD_SIN_DESTINATARIOS' && d.data().consultaId === solaId);
  const pushes = solaId ? await db.collection('user_notifications').where('consultaId', '==', solaId).get() : { empty: true, size: 0 };
  const solaNotif = pushes.empty ? null : pushes.docs.map((d) => d.data())[0];
  report(
    'sin app ni mail queda en la bandeja y no se cierra',
    sola.ok && sola.value?.status === 'ABIERTA' && solaDoc?.status === 'ABIERTA'
      && /Consultados: 1 · 0 con aviso push/.test(String(solaDoc?.resumen || ''))
      && solaInv?.estado === 'PENDIENTE' && solaInv?.entregaPush === 'sin push (no tiene la app instalada)'
      && typeof solaInv?.venceAtMs === 'number' && solaInv.venceAtMs > 0
      && !aviso && pushes.size === 1 && solaNotif && Object.prototype.hasOwnProperty.call(solaNotif, 'employeeId') && !solaNotif.uid
      && solaNotif?.type === 'CONSULTA_DISPONIBILIDAD',
    `${sola.value?.status || sola.message} resumen=${solaDoc?.resumen} inv=${solaInv?.estado} aviso=${aviso} push=${pushes.size}`,
  );

  await db.collection('eventuales_bolsa').doc(CON.cuil).set(bolsa(CON));
  await db.collection('device_tokens').doc(`tok-${CON.uid}`).set({
    uid: CON.uid, token: 'token-consulta-sosa-0123456789', pushEstado: 'activo',
  });
  const mezcla = await intentar(() => crearConsultaDisponibilidad.run(pedido([CON.cuil, SIN.cuil], '2026-11-21'), PLANNER));
  const mixId = mezcla.value?.consultaId;
  const mixDoc = mixId ? (await db.collection('consultas_disponibilidad').doc(mixId).get()).data() : null;
  const invCon = mixId ? (await db.collection('consultas_disponibilidad_invitaciones').doc(`${mixId}_${CON.cuil}`).get()).data() : null;
  const invSin = mixId ? (await db.collection('consultas_disponibilidad_invitaciones').doc(`${mixId}_${SIN.cuil}`).get()).data() : null;
  const notif = mixId
    ? (await db.collection('user_notifications').where('consultaId', '==', mixId).get()).docs.map((d) => d.data())
    : [];
  report(
    'los dos quedan pendientes y el resumen cuenta el push',
    mezcla.ok && mixDoc?.status === 'ABIERTA' && invCon?.estado === 'PENDIENTE' && invSin?.estado === 'PENDIENTE'
      && invCon?.entregaPush === 'push enviado' && invSin?.entregaPush === 'sin push (no tiene la app instalada)'
      && String(mixDoc?.resumen || '') === 'Consultados: 2 · 1 con aviso push'
      && notif.some((n) => n.uid === CON.uid && n.type === 'CONSULTA_DISPONIBILIDAD')
      && notif.some((n) => !n.uid && n.type === 'CONSULTA_DISPONIBILIDAD'),
    `${mixDoc?.status} ${mixDoc?.resumen} con=${invCon?.estado}/${invCon?.entregaPush} sin=${invSin?.estado}/${invSin?.entregaPush} push=${notif.length}`,
  );

  const guardiaId = 'emp-sin-app';
  await db.collection('empleados').doc(guardiaId).set({
    empresaId: EMP, nombre: 'MOLINA, Rita', name: 'MOLINA, Rita', uid: '', status: 'ACTIVE',
  });
  await db.collection('planificacion_estados').doc('obj-peaje_2026_11').set({ publishedAt: admin.firestore.Timestamp.now() });
  await db.collection('turnos').doc('franco-sin-app').set({
    empresaId: EMP, employeeId: guardiaId, employeeName: 'MOLINA, Rita',
    code: 'F', isFranco: true, hours: 0, scheduleDate: '2026-11-22',
    startTime: ts('2026-11-22T03:00:00.000Z'),
    endTime: ts('2026-11-23T02:59:00.000Z'),
    objectiveId: 'obj-peaje', positionName: 'Puesto 1',
  });
  const guardia = await intentar(() => crearConsultaDisponibilidad.run({
    empresaId: EMP, lugares: 1, venceMinutos: 120,
    objectiveId: 'obj-peaje', objectiveName: 'Peaje', positionName: 'Puesto 1', clientName: 'Norte',
    guardias: [{ employeeId: guardiaId, tipo: 'FT', nombre: 'MOLINA, Rita' }],
    jornadas: [{ fecha: '2026-11-22', horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M' }],
  }, PLANNER));
  const gId = guardia.value?.consultaId;
  const gDoc = gId ? (await db.collection('consultas_disponibilidad').doc(gId).get()).data() : null;
  const gInv = gId ? (await db.collection('consultas_disponibilidad_invitaciones').doc(`${gId}_emp_${guardiaId}`).get()).data() : null;
  const gNotif = gId ? (await db.collection('user_notifications').where('consultaId', '==', gId).get()).docs.map((d) => d.data()) : [];
  const gNov = (await db.collection('novedades').where('consultaId', '==', gId || 'ninguna').get()).docs
    .some((d) => d.data().type === 'CONSULTA_DISPONIBILIDAD_SIN_DESTINATARIOS');
  report(
    'guardia propio sin app: bandeja con employeeId y sigue abierta',
    guardia.ok && gDoc?.status === 'ABIERTA' && /Consultados: 1 · 0 con aviso push/.test(String(gDoc?.resumen || ''))
      && gInv?.estado === 'PENDIENTE' && gInv?.entregaPush === 'sin push (no tiene la app instalada)'
      && gNotif.some((n) => n.employeeId === guardiaId && !n.uid) && !gNov,
    `${guardia.value?.status || guardia.message} ${gDoc?.resumen} inv=${gInv?.estado} aviso=${gNov} notif=${gNotif.length}`,
  );

  const falla = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - falla} OK / ${falla} FALLA`);
  process.exit(falla ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
