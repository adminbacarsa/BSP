/**
 * Consulta de disponibilidad de guardias propios: dos francos, uno acepta.
 * Queda el FT en el turno (sin contrato ni ARCA) y el otro recibe «Ya se cubrió, gracias».
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-consulta-guardia "node scripts/eval-consulta-guardias-emulator.mjs"
 * Antes: `npm run build` en apps/functions (o tsc + sync eventuales-shared).
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-consulta-guardia';
admin.initializeApp({ projectId });
const db = admin.firestore();

const { crearConsultaDisponibilidad, responderConsultaDisponibilidad } = requireFn('./lib/eventuales/consultaDisponibilidad.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'cg_emp';
const OBJ = 'obj-peaje';
const FECHA = '2026-11-10';
const PLANNER = { auth: { uid: 'uid-plan', token: { role: 'SuperAdmin', email: 'plan@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const ANA = { employeeId: 'emp-ana', uid: 'uid-ana', nombre: 'Pérez, Ana' };
const LUIS = { employeeId: 'emp-luis', uid: 'uid-luis', nombre: 'Gómez, Luis' };

function ctx(uid) {
  return { auth: { uid, token: { role: 'EMPLEADO' } }, rawRequest: { ip: '10.0.0.9', headers: {} } };
}
function ts(iso) {
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}
async function empleado(p) {
  await db.collection('empleados').doc(p.employeeId).set({
    empresaId: EMP, nombre: p.nombre, name: p.nombre, uid: p.uid, status: 'ACTIVE',
  });
}
async function franco(p) {
  await db.collection('turnos').doc(`franco-${p.employeeId}`).set({
    empresaId: EMP, employeeId: p.employeeId, employeeName: p.nombre,
    code: 'F', isFranco: true, hours: 0, scheduleDate: FECHA,
    startTime: ts('2026-11-10T03:00:00.000Z'),
    endTime: ts('2026-11-11T02:59:00.000Z'),
    objectiveId: OBJ, positionName: 'Puesto 1', draft: true,
  });
}
function pedido(guardias, extra = {}) {
  return {
    empresaId: EMP, guardias, lugares: 1, venceMinutos: 120,
    objectiveId: OBJ, objectiveName: 'Peaje', positionName: 'Puesto 1', clientName: 'Norte',
    cubreEmployeeId: 'emp-titular', cubreNombre: 'Sosa, Eva',
    jornadas: [{ fecha: FECHA, horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M', name: 'Mañana' }],
    ...extra,
  };
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'Guardias SA', status: 'ACTIVE' });
  await db.collection('planificacion_estados').doc(`${OBJ}_2026_11`).set({ publishedAt: admin.firestore.Timestamp.now() });
  await empleado(ANA);
  await empleado(LUIS);
  await franco(ANA);
  await franco(LUIS);

  const creada = await intentar(() => crearConsultaDisponibilidad.run(pedido([
    { employeeId: ANA.employeeId, tipo: 'FT', nombre: ANA.nombre },
    { employeeId: LUIS.employeeId, tipo: 'FT', nombre: LUIS.nombre },
  ]), PLANNER));
  report('consulta a los dos francos', creada.ok && creada.value?.consultados === 2 && creada.value?.lugares === 1, JSON.stringify(creada.value || creada.message));
  const consultaId = creada.value?.consultaId;
  const invAna = consultaId ? await db.collection('consultas_disponibilidad_invitaciones').doc(`${consultaId}_emp_${ANA.employeeId}`).get() : null;
  const texto = String(invAna?.data()?.texto || '');
  report('el push nombra el franco trabajado', texto.includes('como franco trabajado') && texto.includes('1 día'), texto);
  const pushes = consultaId
    ? (await db.collection('user_notifications').where('consultaId', '==', consultaId).get()).docs.map((d) => d.data())
    : [];
  report('aviso por la app a los dos', pushes.filter((n) => n.type === 'CONSULTA_DISPONIBILIDAD').length === 2, String(pushes.length));

  const acepta = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: `${consultaId}_emp_${ANA.employeeId}`, respuesta: 'SI',
  }, ctx(ANA.uid)));
  report('el primero que acepta queda asignado', acepta.ok && acepta.value?.codigo === 'ASIGNADO', JSON.stringify(acepta.value || acepta.message));

  const turnoAna = (await db.collection('turnos').doc(`franco-${ANA.employeeId}`).get()).data() || {};
  report('el franco pasa a FT en el mismo turno', turnoAna.isFrancoTrabajado === true && turnoAna.isFranco === false && turnoAna.code === 'M' && turnoAna.hours === 8 && turnoAna.esEventual !== true && turnoAna.draft === false, `code=${turnoAna.code} ft=${turnoAna.isFrancoTrabajado} draft=${turnoAna.draft}`);
  const contratos = await db.collection('contratos_eventuales').where('empresaId', '==', EMP).get();
  const arca = await db.collection('arca_envios').where('empresaId', '==', EMP).get();
  report('no hay contrato ni ARCA', contratos.empty && arca.empty, `contratos=${contratos.size} arca=${arca.size}`);

  const otro = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: `${consultaId}_emp_${LUIS.employeeId}`, respuesta: 'SI',
  }, ctx(LUIS.uid)));
  const invLuis = consultaId ? (await db.collection('consultas_disponibilidad_invitaciones').doc(`${consultaId}_emp_${LUIS.employeeId}`).get()).data() : null;
  const avisoLuis = pushes.length
    ? (await db.collection('user_notifications').where('uid', '==', LUIS.uid).get()).docs.map((d) => d.data())
    : [];
  report('el otro recibe que ya se cubrió', otro.value?.codigo === 'COMPLETA' && invLuis?.estado === 'CUBIERTO' && invLuis?.motivo === 'Ya se cubrió, gracias' && avisoLuis.some((n) => n.type === 'CONSULTA_CUBIERTA' && n.body === 'Ya se cubrió, gracias'), `${otro.value?.codigo || otro.message} estado=${invLuis?.estado} motivo=${invLuis?.motivo}`);
  const turnoLuis = (await db.collection('turnos').doc(`franco-${LUIS.employeeId}`).get()).data() || {};
  report('el que no llegó sigue de franco', turnoLuis.code === 'F' && turnoLuis.isFrancoTrabajado !== true, `code=${turnoLuis.code}`);

  const parent = consultaId ? (await db.collection('consultas_disponibilidad').doc(consultaId).get()).data() : null;
  const eventos = consultaId ? await db.collection('consultas_disponibilidad').doc(consultaId).collection('eventos').get() : { docs: [] };
  const tipos = new Set(eventos.docs.map((d) => d.data().tipo));
  report('auditoría CREADA, RESPUESTA, ASIGNADO y CERRADA', parent?.status === 'COMPLETA' && ['CREADA', 'RESPUESTA', 'ASIGNADO', 'CERRADA'].every((t) => tipos.has(t)), `${parent?.status} ${[...tipos].join(',')}`);

  const pinId = 'emp-pin';
  await db.collection('empleados').doc(pinId).set({ empresaId: EMP, nombre: 'Ríos, Nico', uid: 'uid-pin', status: 'ACTIVE' });
  await db.collection('turnos').doc('ayer-pin').set({
    empresaId: EMP, employeeId: pinId, code: 'T', hours: 8, scheduleDate: '2026-11-09',
    startTime: ts('2026-11-09T18:00:00.000Z'), endTime: ts('2026-11-10T02:00:00.000Z'),
    objectiveId: OBJ, positionName: 'Puesto 1',
  });
  const jornadaCorta = [{ fecha: FECHA, horaInicio: '09:00', horaFin: '17:00', horas: 8, code: 'M' }];
  const sinPin = await intentar(() => crearConsultaDisponibilidad.run(pedido(
    [{ employeeId: pinId, tipo: 'LIBRE' }],
    { jornadas: jornadaCorta },
  ), PLANNER));
  report('descanso de 8 a 12 h sin PIN no se consulta', !sinPin.ok && /PIN|8/.test(String(sinPin.message)), sinPin.message);

  const conPin = await intentar(() => crearConsultaDisponibilidad.run(pedido(
    [{ employeeId: pinId, tipo: 'LIBRE' }],
    { jornadas: jornadaCorta, autorizaciones: [{ employeeId: pinId, kind: 'DESCANSO', motivo: 'viene de otro objetivo', autorizadoPor: 'Supervisor' }] },
  ), PLANNER));
  report('con el PIN concedido al enviar, sí se consulta', conPin.ok && conPin.value?.consultados === 1, JSON.stringify(conPin.value || conPin.message));

  await db.collection('roles').doc('solo-update').set({ permissions: { PLANNING: ['update'] } });
  await db.collection('system_users').doc('uid-upd').set({ role: 'solo-update' });
  const sinFt = await intentar(() => crearConsultaDisponibilidad.run(pedido([{ employeeId: ANA.employeeId, tipo: 'FT' }]), {
    auth: { uid: 'uid-upd', token: { role: 'OPERADOR', email: 'upd@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.1', headers: {} },
  }));
  report('sin assign_ft no se consulta el franco', !sinFt.ok && /franco trabajado/.test(String(sinFt.message)), sinFt.message);

  const licId = 'emp-lic';
  await db.collection('empleados').doc(licId).set({ empresaId: EMP, nombre: 'Díaz, Sol', uid: 'uid-lic', status: 'ACTIVE' });
  await db.collection('turnos').doc(`franco-${licId}`).set({
    empresaId: EMP, employeeId: licId, code: 'F', isFranco: true, hours: 0, scheduleDate: FECHA,
    startTime: ts('2026-11-10T03:00:00.000Z'), endTime: ts('2026-11-11T02:59:00.000Z'),
    objectiveId: OBJ,
  });
  const porLicencia = await intentar(() => crearConsultaDisponibilidad.run(pedido([{ employeeId: licId, tipo: 'FT' }], { jornadas: [{ fecha: '2026-11-12', horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M' }] }), PLANNER));
  report('sin el franco de ese día no entra', !porLicencia.ok, porLicencia.message || JSON.stringify(porLicencia.value));

  await franco({ employeeId: licId, uid: 'uid-lic', nombre: 'Díaz, Sol' });
  const abierta = await intentar(() => crearConsultaDisponibilidad.run(pedido([{ employeeId: licId, tipo: 'FT', nombre: 'Díaz, Sol' }], { jornadas: [{ fecha: FECHA, horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M' }] }), PLANNER));
  if (abierta.value?.consultaId) {
    await db.collection('turnos').doc(`franco-${licId}`).update({ code: 'V', isFranco: false });
  }
  const rechazo = abierta.value?.consultaId
    ? await intentar(() => responderConsultaDisponibilidad.run({ invitacionId: `${abierta.value.consultaId}_emp_${licId}`, respuesta: 'SI' }, ctx('uid-lic')))
    : { ok: false, message: 'no se creó' };
  const parentLic = abierta.value?.consultaId ? (await db.collection('consultas_disponibilidad').doc(abierta.value.consultaId).get()).data() : null;
  report('si al aceptar ya tiene licencia el lugar sigue libre', rechazo.value?.codigo === 'NO_ELEGIBLE' && Number(parentLic?.tomados) === 0 && parentLic?.status === 'ABIERTA', `${rechazo.value?.codigo || rechazo.message} tomados=${parentLic?.tomados}`);

  const fallas = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fallas.length}/${results.length}`);
  process.exit(fallas.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
