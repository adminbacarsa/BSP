/**
 * Al cerrar la consulta, las invitaciones dejan de quedar abiertas.
 * Uno acepta → el otro queda CUBIERTO y recibe el aviso.
 * Cancelar cierra también AVISO_MAIL. Vencer deja VENCIDA, sin push.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-consulta-cierre "node scripts/eval-consulta-cierre-invitaciones-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-consulta-cierre';
admin.initializeApp({ projectId });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const {
  crearConsultaDisponibilidad,
  responderConsultaDisponibilidad,
  cancelarConsultaDisponibilidad,
  vencerConsultasDisponibilidad,
} = requireFn('./lib/eventuales/consultaDisponibilidad.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'cierre_emp';
const PLANNER = { auth: { uid: 'uid-plan', token: { role: 'SuperAdmin', email: 'plan@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const ANA = { cuil: '20111111119', nombre: 'Pérez, Ana', uid: 'uid-ana' };
const LUIS = { cuil: '20222222226', nombre: 'Gómez, Luis', uid: 'uid-luis' };
const CUBIERTO = 'Ya se asignó a otra persona. ¡Gracias!';
const CANCELADA = 'Ya no hace falta, gracias';

function bolsa(p, extra = {}) {
  return {
    cuil: p.cuil, nombre: p.nombre, uid: p.uid || '', disponibilidad: 'DISPONIBLE', empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    mail: p.uid ? `${p.uid}@bacarsa.com.ar` : '', telefono: '3510000000', domicilio: 'Cordoba',
    marcos: { [EMP]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } },
    status: 'ACTIVE', ...extra,
  };
}
function ctxEv(p) {
  return { auth: { uid: p.uid, token: { role: 'EVENTUAL', bolsaCuil: p.cuil } }, rawRequest: { ip: '10.0.0.9', headers: {} } };
}
function pedido(cuils, fecha, extra = {}) {
  return {
    empresaId: EMP, cuils, lugares: 1, venceMinutos: 120,
    objectiveName: 'Peaje', positionName: 'Puesto 1', clientName: 'Norte',
    jornadas: [{ fecha, horaInicio: '08:00', horaFin: '16:00', horas: 8, code: 'M' }],
    ...extra,
  };
}
function appLaLista(estado, venceAtMs) {
  if (estado !== 'PENDIENTE' && estado !== 'AVISO_MAIL') return false;
  if (venceAtMs && venceAtMs <= Date.now()) return false;
  return true;
}
async function invDe(consultaId, cuil) {
  const snap = await db.collection('consultas_disponibilidad_invitaciones').doc(`${consultaId}_${cuil}`).get();
  return snap.data() || null;
}
async function avisosDe(consultaId) {
  const snap = await db.collection('user_notifications').where('consultaId', '==', consultaId).get();
  return snap.docs.map((d) => d.data());
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'Cierre SA', status: 'ACTIVE' });
  for (const p of [ANA, LUIS]) {
    await db.collection('eventuales_bolsa').doc(p.cuil).set(bolsa(p));
    await db.collection('device_tokens').doc(`tok-${p.uid}`).set({
      uid: p.uid, token: `token-cierre-${p.uid}-0123456789`, pushEstado: 'activo',
    });
  }

  const inicio = Date.parse('2026-12-02T08:00:00.000-03:00');
  const hasta = await intentar(() => crearConsultaDisponibilidad.run(pedido([ANA.cuil], '2026-12-02', { venceMinutos: 0 }), PLANNER));
  const invHasta = hasta.value?.consultaId ? await invDe(hasta.value.consultaId, ANA.cuil) : null;
  report(
    'hasta el inicio guarda venceAtMs en la invitación',
    hasta.ok && invHasta?.venceAtMs === inicio,
    `vence=${invHasta?.venceAtMs} inicio=${inicio} ${hasta.message || ''}`,
  );

  const creada = await intentar(() => crearConsultaDisponibilidad.run(pedido([ANA.cuil, LUIS.cuil], '2026-12-03'), PLANNER));
  const consultaId = creada.value?.consultaId;
  const acepta = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: `${consultaId}_${ANA.cuil}`, respuesta: 'SI',
  }, ctxEv(ANA)));
  const invLuis = consultaId ? await invDe(consultaId, LUIS.cuil) : null;
  const avisos = consultaId ? await avisosDe(consultaId) : [];
  const avisoLuis = avisos.find((n) => n.type === 'CONSULTA_CUBIERTA' && n.invitacionId === `${consultaId}_${LUIS.cuil}`);
  const tarde = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: `${consultaId}_${LUIS.cuil}`, respuesta: 'SI',
  }, ctxEv(LUIS)));
  report(
    'uno acepta y el otro queda CUBIERTO con aviso',
    acepta.ok && acepta.value?.codigo === 'ASIGNADO'
      && invLuis?.estado === 'CUBIERTO' && invLuis?.motivo === CUBIERTO && invLuis?.cerradaAt
      && typeof invLuis?.venceAtMs === 'number' && invLuis.venceAtMs > 0
      && avisoLuis?.body === CUBIERTO && avisoLuis?.title === 'Ya se asignó a otra persona'
      && typeof avisoLuis?.employeeId === 'string' && avisoLuis.employeeId.length > 0
      && appLaLista(invLuis?.estado, invLuis?.venceAtMs) === false
      && tarde.ok && tarde.value?.ok === false && tarde.value?.codigo === 'COMPLETA' && tarde.value?.motivo === CUBIERTO,
    `acepta=${acepta.value?.codigo || acepta.message} estado=${invLuis?.estado} motivo=${invLuis?.motivo} aviso=${avisoLuis?.type} tarde=${tarde.value?.motivo || tarde.message}`,
  );

  const mail = await intentar(() => crearConsultaDisponibilidad.run(pedido([ANA.cuil, LUIS.cuil], '2026-12-04'), PLANNER));
  const mailId = mail.value?.consultaId;
  if (mailId) {
    await db.collection('consultas_disponibilidad_invitaciones').doc(`${mailId}_${LUIS.cuil}`).update({
      estado: 'AVISO_MAIL',
      mailOk: true,
      uid: '',
      venceAtMs: FieldValue.delete(),
    });
    await db.collection('consultas_disponibilidad').doc(mailId).update({
      respuestas: [
        { cuil: ANA.cuil, nombre: ANA.nombre, estado: 'PENDIENTE', orden: null, hora: null, motivo: null },
        { cuil: LUIS.cuil, nombre: LUIS.nombre, estado: 'AVISO_MAIL', orden: null, hora: null, motivo: 'no tiene la app' },
      ],
    });
  }
  await db.collection('eventuales_bolsa').doc(LUIS.cuil).update({ mail: '' });
  const cancel = await intentar(() => cancelarConsultaDisponibilidad.run({ consultaId: mailId, empresaId: EMP }, PLANNER));
  const invAnaMail = mailId ? await invDe(mailId, ANA.cuil) : null;
  const invLuisMail = mailId ? await invDe(mailId, LUIS.cuil) : null;
  const avisosMail = mailId ? await avisosDe(mailId) : [];
  const cierreMail = avisosMail.filter((n) => n.type === 'CONSULTA_CANCELADA');
  const respondio = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: `${mailId}_${ANA.cuil}`, respuesta: 'SI',
  }, ctxEv(ANA)));
  report(
    'cancelar cierra AVISO_MAIL y PENDIENTE, y avisa',
    cancel.ok && cancel.value?.codigo === 'CERRADA'
      && invAnaMail?.estado === 'CANCELADA' && invAnaMail?.motivo === CANCELADA && invAnaMail?.cerradaAt
      && invLuisMail?.estado === 'CANCELADA' && invLuisMail?.motivo === CANCELADA
      && typeof invLuisMail?.venceAtMs === 'number' && invLuisMail.venceAtMs > 0
      && cierreMail.length === 2 && cierreMail.every((n) => n.body === CANCELADA && n.title === 'Ya no hace falta' && 'employeeId' in n)
      && appLaLista('CANCELADA', invAnaMail?.venceAtMs) === false
      && respondio.ok && respondio.value?.ok === false && respondio.value?.motivo === CANCELADA,
    `cancel=${cancel.value?.codigo || cancel.message} ana=${invAnaMail?.estado} luis=${invLuisMail?.estado} vence=${invLuisMail?.venceAtMs} avisos=${cierreMail.length} resp=${respondio.value?.motivo || respondio.message}`,
  );

  const porVencer = await intentar(() => crearConsultaDisponibilidad.run(pedido([ANA.cuil], '2026-12-05'), PLANNER));
  const vid = porVencer.value?.consultaId;
  if (vid) {
    await db.collection('consultas_disponibilidad').doc(vid).update({
      venceAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60_000),
      venceAtMs: Date.now() - 60_000,
    });
  }
  const vencidas = await vencerConsultasDisponibilidad(admin.firestore.Timestamp.now());
  const parentV = vid ? (await db.collection('consultas_disponibilidad').doc(vid).get()).data() : null;
  const invV = vid ? await invDe(vid, ANA.cuil) : null;
  const avisosV = vid ? await avisosDe(vid) : [];
  const novedad = (await db.collection('novedades').where('empresaId', '==', EMP).get()).docs
    .some((d) => d.data().type === 'CONSULTA_DISPONIBILIDAD_VENCIDA' && d.data().consultaId === vid);
  report(
    'vencer deja la invitación VENCIDA y no manda push',
    vencidas >= 1 && parentV?.status === 'VENCIDA' && novedad
      && invV?.estado === 'VENCIDA' && invV?.motivo === 'La consulta venció.' && invV?.cerradaAt
      && typeof invV?.venceAtMs === 'number'
      && !avisosV.some((n) => n.type === 'CONSULTA_CUBIERTA' || n.type === 'CONSULTA_CANCELADA')
      && appLaLista(invV?.estado, invV?.venceAtMs) === false,
    `n=${vencidas} status=${parentV?.status} inv=${invV?.estado} avisoPlan=${novedad} pushCierre=${avisosV.filter((n) => n.type !== 'CONSULTA_DISPONIBILIDAD').length}`,
  );

  const falla = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - falla} OK / ${falla} FALLA`);
  process.exit(falla ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
