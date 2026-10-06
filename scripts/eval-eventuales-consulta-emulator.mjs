/**
 * Consulta de disponibilidad: 2 lugares, 3 consultados, dos «sí» a la vez.
 * El tercero queda afuera, uno no elegible no se queda el lugar, y el vencimiento avisa.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-consulta "node scripts/eval-eventuales-consulta-emulator.mjs"
 * Antes: `npm run build` en apps/functions.
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-consulta';
admin.initializeApp({ projectId });
const db = admin.firestore();

const { crearConsultaDisponibilidad, responderConsultaDisponibilidad, vencerConsultasDisponibilidad } = requireFn('./lib/eventuales/consultaDisponibilidad.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'cd_emp';
const PLANNER = { auth: { uid: 'uid-plan', token: { role: 'SuperAdmin', email: 'plan@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const PERSONAS = [
  { cuil: '20111111119', nombre: 'Pérez, Ana', uid: 'uid-ana' },
  { cuil: '20222222226', nombre: 'Gómez, Luis', uid: 'uid-luis' },
  { cuil: '20333333333', nombre: 'Díaz, Sol', uid: 'uid-sol' },
];

function bolsa(p, extra = {}) {
  return {
    cuil: p.cuil, nombre: p.nombre, uid: p.uid, disponibilidad: 'DISPONIBLE', empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    mail: `${p.uid}@bacarsa.com.ar`, telefono: '3510000000', domicilio: 'Cordoba',
    marcos: { [EMP]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } },
    status: 'ACTIVE', ...extra,
  };
}
function ctxEv(p) {
  return { auth: { uid: p.uid, token: { role: 'EVENTUAL', bolsaCuil: p.cuil } }, rawRequest: { ip: '10.0.0.9', headers: {} } };
}
function pedido(cuils, lugares, fecha = '2026-11-10') {
  return {
    empresaId: EMP, cuils, lugares, venceMinutos: 120,
    objectiveName: 'Peaje', positionName: 'Puesto 1', clientName: 'Norte',
    jornadas: [{ fecha, horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M' }],
  };
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'Consulta SA', status: 'ACTIVE' });
  for (const p of PERSONAS) await db.collection('eventuales_bolsa').doc(p.cuil).set(bolsa(p));

  const sinPermiso = await intentar(() => crearConsultaDisponibilidad.run(pedido([PERSONAS[0].cuil], 1), {
    auth: { uid: 'uid-op', token: { role: 'OPERADOR' } }, rawRequest: { ip: '10.0.0.1', headers: {} },
  }));
  report('sin permiso no crea la consulta', !sinPermiso.ok && sinPermiso.code === 'permission-denied', sinPermiso.code || sinPermiso.message);

  const creada = await intentar(() => crearConsultaDisponibilidad.run(pedido(PERSONAS.map((p) => p.cuil), 2), PLANNER));
  report('crea 2 lugares y 3 consultados', creada.ok && creada.value?.lugares === 2 && creada.value?.consultados === 3, JSON.stringify(creada.value || creada.message));
  const consultaId = creada.value?.consultaId;

  const respuestas = await Promise.all(PERSONAS.map((p) => intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: `${consultaId}_${p.cuil}`, respuesta: 'SI',
  }, ctxEv(p)))));
  const asignados = respuestas.filter((r) => r.ok && r.value?.codigo === 'ASIGNADO');
  const afuera = respuestas.filter((r) => r.ok && r.value?.ok === false && r.value?.codigo === 'COMPLETA');
  report('dos sí simultáneos toman los lugares y el tercero no', asignados.length === 2 && afuera.length === 1, respuestas.map((r) => r.value?.codigo || r.message).join(','));

  const parent = consultaId ? (await db.collection('consultas_disponibilidad').doc(consultaId).get()).data() : null;
  report('la consulta queda cubierta', parent?.status === 'COMPLETA' && Number(parent?.tomados) === 2, `${parent?.status} tomados=${parent?.tomados}`);
  const turnos = await db.collection('turnos').where('empresaId', '==', EMP).get();
  const deLaConsulta = turnos.docs.filter((d) => PERSONAS.some((p) => d.data().bolsaCuil === p.cuil) && d.data().scheduleDate === '2026-11-10');
  report('quedan dos turnos asignados', deLaConsulta.length === 2, String(deLaConsulta.length));
  const invs = await Promise.all(PERSONAS.map((p) => db.collection('consultas_disponibilidad_invitaciones').doc(`${consultaId}_${p.cuil}`).get()));
  const cubierto = invs.filter((d) => d.data()?.estado === 'CUBIERTO').length;
  report('el que no llegó queda cerrado con el cupo', cubierto === 1, invs.map((d) => d.data()?.estado).join(','));
  const eventos = consultaId ? await db.collection('consultas_disponibilidad').doc(consultaId).collection('eventos').get() : { docs: [] };
  const tipos = new Set(eventos.docs.map((d) => d.data().tipo));
  report('auditoría CREADA, RESPUESTA, ASIGNADO y CERRADA', ['CREADA', 'RESPUESTA', 'ASIGNADO', 'CERRADA'].every((t) => tipos.has(t)), [...tipos].join(','));
  const audit = await db.collection('audit_logs').where('empresaId', '==', EMP).get();
  report('audit_logs de la consulta', audit.docs.some((d) => String(d.data().action || '').startsWith('CONSULTA_DISPONIBILIDAD')), String(audit.size));

  const malo = { cuil: '20444444440', nombre: 'Ríos, Nico', uid: 'uid-nico' };
  await db.collection('eventuales_bolsa').doc(malo.cuil).set(bolsa(malo));
  const una = await intentar(() => crearConsultaDisponibilidad.run(pedido([malo.cuil], 1, '2026-11-12'), PLANNER));
  await db.collection('eventuales_bolsa').doc(malo.cuil).update({ credencialVencimiento: '2020-01-01' });
  const rechazo = await intentar(() => responderConsultaDisponibilidad.run({ invitacionId: `${una.value?.consultaId}_${malo.cuil}`, respuesta: 'SI' }, ctxEv(malo)));
  const parentMalo = una.value?.consultaId ? (await db.collection('consultas_disponibilidad').doc(una.value.consultaId).get()).data() : null;
  report('si al revalidar no es elegible el lugar sigue libre', rechazo.ok && rechazo.value?.codigo === 'NO_ELEGIBLE' && Number(parentMalo?.tomados) === 0 && parentMalo?.status === 'ABIERTA', `${rechazo.value?.codigo || rechazo.message} tomados=${parentMalo?.tomados}`);

  const vence = { cuil: '20555555557', nombre: 'Sosa, Eva', uid: 'uid-eva' };
  await db.collection('eventuales_bolsa').doc(vence.cuil).set(bolsa(vence));
  const porVencer = await intentar(() => crearConsultaDisponibilidad.run(pedido([vence.cuil], 1, '2026-11-14'), PLANNER));
  const vid = porVencer.value?.consultaId;
  if (vid) {
    await db.collection('consultas_disponibilidad').doc(vid).update({
      venceAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60_000),
      venceAtMs: Date.now() - 60_000,
    });
  }
  const vencidas = await vencerConsultasDisponibilidad(admin.firestore.Timestamp.now());
  const parentV = vid ? (await db.collection('consultas_disponibilidad').doc(vid).get()).data() : null;
  const novedades = await db.collection('novedades').where('empresaId', '==', EMP).get();
  const aviso = novedades.docs.some((d) => d.data().type === 'CONSULTA_DISPONIBILIDAD_VENCIDA' && d.data().consultaId === vid);
  report('al vencer avisa al planificador', vencidas >= 1 && parentV?.status === 'VENCIDA' && aviso, `n=${vencidas} status=${parentV?.status} aviso=${aviso}`);

  const falla = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - falla} OK / ${falla} FALLA`);
  process.exit(falla ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
