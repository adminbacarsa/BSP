/**
 * Circuito completo del eventual en un evento: convocar → aceptar → EV + contrato + AT + anexo; rechazo y
 * vencimiento no generan nada; switches de pruebas (marco / alta ARCA). Emulador aislado (no el lab :8080).
 *   firebase emulators:exec --only firestore,storage --config firebase.e2e-p2.json --project demo-ev-evento "node scripts/eval-eventuales-evento-circuito-emulator.mjs"
 * Antes: `npm run build` en apps/functions.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { plazoAnulacionAlta } from '../apps/web2/src/lib/eventuales/plazoAnulacion.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-evento';
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { convocarEventualEvento, vencerConvocatoriasEventualesEvento } = requireFn('./lib/eventuales/planificacionEventuales.js');
const { respondEventoConvocatoria, noPuedoAsistirEventual } = requireFn('./lib/eventos/eventoPortalCallables.js');
const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
const { confirmarAnexoEventual } = requireFn('./lib/eventuales/marcoAnexoCall.js');
const { gestionarEventual } = requireFn('./lib/eventuales/gestionarEventual.js');
const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}
const ctxSuper = (uid = 'uid-coordinador') => ({ auth: { uid, token: { role: 'SuperAdmin' } }, rawRequest: { ip: '10.0.0.5', headers: {} } });
const ctxEventual = (uid, cuil) => ({ auth: { uid, token: { role: 'EVENTUAL', bolsaCuil: cuil } }, rawRequest: { ip: '10.0.0.9', headers: {} } });
const ctxRol = (uid) => ({ auth: { uid, token: { role: '' } }, rawRequest: { ip: '10.0.0.5', headers: {} } });

/** Fecha y hora AR de un instante (misma zona que `tsAr` / `hoyAr` del servidor). */
function arParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return { fecha: `${get('year')}-${get('month')}-${get('day')}`, hora: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}
function jornadaDesde(startMs, horas) {
  const i = arParts(startMs);
  const f = arParts(startMs + horas * 3600000);
  return { fecha: i.fecha, horaInicio: i.hora, horaFin: f.hora, horas };
}

/**
 * Inicio pasado cuyo plazo de anulación (RG 2988 art. 9) ya venció hoy, sea el día que sea.
 * Un domingo o un viernes de noche corren el vencimiento al lunes 12:00: se retrocede de a 24 h
 * hasta que `plazoAnulacionAlta` dice que ya no se puede anular (sin feriados, igual que el servidor en el test).
 */
function inicioConAnulacionVencida(ahoraMs, horas) {
  for (let atras = 30; atras <= 30 + 24 * 7; atras += 24) {
    const startMs = ahoraMs - atras * 3600000;
    const j = jornadaDesde(startMs, horas);
    if (!plazoAnulacionAlta({ fechaInicio: j.fecha, horaInicio: j.horaInicio, ahoraMs }).puedeAnular) return { startMs, jornada: j };
  }
  throw new Error('No se encontró un inicio con la anulación vencida.');
}

function bolsa(cuil, extra) {
  return {
    cuil,
    nombre: extra.nombre,
    disponibilidad: 'DISPONIBLE',
    empresasHabilitadas: extra.empresasHabilitadas ?? ['ev_emp'],
    credencialVencimiento: '2027-06-01',
    aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    domicilioGeo: { lat: -31.41, lon: -64.19 },
    confiabilidad: 5,
    uid: extra.uid,
    dni: extra.dni || '30111222',
    mail: '',
    status: 'ACTIVE',
    marcos: extra.marcos === undefined
      ? { ev_emp: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } }
      : extra.marcos,
  };
}

async function docsDe(coleccion, cuil) {
  const snap = await db.collection(coleccion).where('bolsaCuil', '==', cuil).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function sinNada(cuil) {
  const [t, c, a] = await Promise.all([docsDe('turnos', cuil), docsDe('contratos_eventuales', cuil), docsDe('arca_envios', cuil)]);
  return { ok: t.length === 0 && c.length === 0 && a.length === 0, detalle: `turnos=${t.length} contratos=${c.length} arca=${a.length}` };
}

async function main() {
  const empresaId = 'ev_emp';
  const evento = { eventoId: 'evento-1', eventoNombre: 'Recital Plaza', servicioId: 'srv-acceso', servicioNombre: 'Acceso' };
  const jornadaUrgente = jornadaDesde(Date.now() + 2 * 3600000, 6); // < 24 h → AT URGENTE
  const base = { empresaId, evento, jornada: jornadaUrgente, clientId: 'ev_cli', clientName: 'Cliente', positionName: 'Acceso' };

  const cuilA = '20111111119';
  const cuilB = '20333333337';
  const cuilC = '20222222228';
  const cuilD = '20444444446';
  await db.collection('empresas').doc(empresaId).set({ nombre: 'Empresa EV', razonSocial: 'Empresa EV S.A.', cuit: '30111111118', centroControlEnabled: true });
  await db.collection('roles').doc('rol_lector').set({ name: 'Lector', permissions: { EVENTUALES: ['read', 'convocar'] } });
  await db.collection('system_users').doc('uid-lector').set({ empresaId, role: 'rol_lector', status: 'ACTIVE' });
  await db.collection('eventuales_bolsa').doc(cuilA).set(bolsa(cuilA, { nombre: 'Perez, Ana', uid: 'uid-ev-a' }));
  await db.collection('eventuales_bolsa').doc(cuilB).set(bolsa(cuilB, { nombre: 'Gomez, Sol', uid: 'uid-ev-b', marcos: {}, empresasHabilitadas: [] }));
  await db.collection('eventuales_bolsa').doc(cuilC).set(bolsa(cuilC, { nombre: 'Lopez, Luis', uid: 'uid-ev-c' }));
  await db.collection('eventuales_bolsa').doc(cuilD).set(bolsa(cuilD, { nombre: 'Diaz, Eva', uid: 'uid-ev-d' }));
  // Token push: el código del anexo sale por la bandeja de la app (sin mail en el emulador).
  await db.collection('device_tokens').doc('uid-ev-a').set({ uid: 'uid-ev-a', token: 'token-e2e-eventual-a-0123456789' });

  // ── 1) Convocar: nace la solicitud, nada más ──
  const conv = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilA }, ctxSuper()));
  const solA = conv.ok ? (await db.collection('solicitudes_evento').doc(conv.value.solicitudId).get()).data() : null;
  const nadaA = await sinNada(cuilA);
  report(
    'convocar: solicitud convocado con venceAt, sin turno/contrato/AT',
    conv.ok && solA?.status === 'convocado' && solA?.esEventual === true && solA?.bolsaCuil === cuilA && solA?.tipo === 'admin_convoca'
      && !!solA?.venceAt && solA?.anexoEstado === 'PENDIENTE_ACEPTACION' && solA?.pruebasSinMarco === false && nadaA.ok,
    conv.ok ? `status=${solA?.status} ${nadaA.detalle}` : conv.message,
  );
  const legajoA = conv.ok ? (await db.collection('empleados').doc(conv.value.employeeId).get()).data() : null;
  report('convocar: legajo EVENTUAL con uid del acceso (para el push y la app)', legajoA?.modalidad === 'EVENTUAL' && legajoA?.uid === 'uid-ev-a' && legajoA?.bolsaCuil === cuilA, `uid=${legajoA?.uid}`);
  const dup = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilA }, ctxSuper()));
  report('convocar dos veces al mismo servicio se rechaza', !dup.ok && dup.code === 'already-exists', dup.message || '');

  // ── 2) Acepta en la app: EV + contrato CONFIRMADO + AT URGENTE + código del anexo ──
  const acepta = await intentar(() => respondEventoConvocatoria.run({ solicitudId: conv.value.solicitudId, accept: true }, ctxEventual('uid-ev-a', cuilA)));
  const solA2 = (await db.collection('solicitudes_evento').doc(conv.value.solicitudId).get()).data() || {};
  const turnosA = await docsDe('turnos', cuilA);
  const turnoA = turnosA[0] || {};
  const contratosA = await docsDe('contratos_eventuales', cuilA);
  const arcaA = (await docsDe('arca_envios', cuilA)).find((e) => e.tipo === 'AT') || {};
  report(
    'aceptar: turno EV del evento + contrato CONFIRMADO',
    acepta.ok && acepta.value?.status === 'aprobada' && turnosA.length === 1 && turnoA.code === 'EV' && turnoA.origin === 'EVENTO' && turnoA.eventoId === 'evento-1'
      && turnoA.solicitudEventoId === conv.value.solicitudId && turnoA.eventualExigirAltaArca === true && turnoA.eventualAltaArcaConfirmada === false
      && contratosA.length === 1 && contratosA[0].estado === 'CONFIRMADO' && solA2.status === 'aprobada' && solA2.contratoId === contratosA[0].id && !solA2.venceAt,
    acepta.ok ? `turnos=${turnosA.length} contrato=${contratosA[0]?.estado} sol=${solA2.status}` : acepta.message,
  );
  report('aceptar: AT en cola URGENTE (evento en < 24 h)', arcaA.tipo === 'AT' && arcaA.canal === 'URGENTE' && arcaA.estado === 'PENDIENTE' && !arcaA.nroTransaccion && solA2.arcaCanal === 'URGENTE', `canal=${arcaA.canal} estado=${arcaA.estado}`);
  const codigoDoc = solA2.contratoId ? (await db.collection('anexo_codigos').doc(solA2.contratoId).get()).data() : null;
  const notifA = (await db.collection('user_notifications').where('uid', '==', 'uid-ev-a').get()).docs.map((d) => d.data());
  const notifCodigo = notifA.find((n) => n.type === 'CODIGO_ANEXO');
  report(
    'aceptar: anexo pendiente con código OTP por la app + aviso Evento confirmado',
    solA2.anexoEstado === 'PENDIENTE' && codigoDoc?.usado === false && (codigoDoc?.canales || []).includes('PUSH') && !!notifCodigo
      && notifA.some((n) => n.type === 'EVENTO_CONFIRMADO' && n.contratoId === solA2.contratoId),
    `anexo=${solA2.anexoEstado} canales=${(codigoDoc?.canales || []).join(',')} notifs=${notifA.map((n) => n.type).join(',')}`,
  );
  const codigo = String(notifCodigo?.body || '').match(/\b(\d{6})\b/)?.[1] || '';
  const firma = await intentar(() => confirmarAnexoEventual.run({ contratoId: solA2.contratoId, codigo, dispositivo: 'e2e-device' }, ctxEventual('uid-ev-a', cuilA)));
  const solA3 = (await db.collection('solicitudes_evento').doc(conv.value.solicitudId).get()).data() || {};
  report('anexo firmado con el código → Estado convocatoria lo muestra FIRMADO', firma.ok && firma.value?.ok === true && solA3.anexoEstado === 'FIRMADO' && !!solA3.anexoHash, firma.ok ? `anexo=${solA3.anexoEstado}` : firma.message);
  const fichaA = await intentar(() => registrarPresencia(db, { shiftId: turnoA.id, empId: turnoA.employeeId, source: 'OPERATIONS', recordedAt: new Date().toISOString() }));
  report('fichada bloqueada hasta el alta ARCA (switch ON)', !fichaA.ok && fichaA.message === 'ALTA_ARCA_PENDIENTE' && evaluateServerCheckInWindow(turnoA, Date.now(), { source: 'OPERATIONS' }).rejectCode === 'ALTA_ARCA_PENDIENTE', fichaA.message || 'fichó');
  const audA = await db.collection('audit_logs').where('action', 'in', ['EVENTUAL_CONVOCADO_EVENTO', 'EVENTUAL_ACEPTO_EVENTO']).get();
  report('audit_logs de convocatoria y aceptación', audA.size >= 2, `n=${audA.size}`);

  // ── 3) Rechaza: no se genera nada ──
  const convC = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilC }, ctxSuper()));
  const rechazo = await intentar(() => respondEventoConvocatoria.run({ solicitudId: convC.value?.solicitudId, accept: false }, ctxEventual('uid-ev-c', cuilC)));
  const solC = convC.ok ? (await db.collection('solicitudes_evento').doc(convC.value.solicitudId).get()).data() : null;
  const nadaC = await sinNada(cuilC);
  report('rechazar: solicitud rechazada, sin turno/contrato/AT, sin venceAt', convC.ok && rechazo.ok && solC?.status === 'rechazada' && !solC?.venceAt && nadaC.ok, rechazo.ok ? nadaC.detalle : rechazo.message);
  const otraVezC = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilC }, ctxSuper()));
  report('tras rechazar se lo puede volver a convocar (lugar libre)', otraVezC.ok && otraVezC.value?.solicitudId !== convC.value?.solicitudId, otraVezC.message || '');

  // ── 4) No responde: vence con el timeout de convocatorias y queda libre ──
  const convD = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilD }, ctxSuper()));
  await db.collection('solicitudes_evento').doc(convD.value.solicitudId).update({ venceAt: Timestamp.fromMillis(Date.now() - 60000) });
  const vencidas = await vencerConvocatoriasEventualesEvento();
  const solD = (await db.collection('solicitudes_evento').doc(convD.value.solicitudId).get()).data() || {};
  const nadaD = await sinNada(cuilD);
  report('vencer: convocado sin respuesta pasa a vencida y no genera nada', vencidas >= 1 && solD.status === 'vencida' && !!solD.vencidaAt && !solD.venceAt && nadaD.ok, `vencidas=${vencidas} status=${solD.status} ${nadaD.detalle}`);
  const tarde = await intentar(() => respondEventoConvocatoria.run({ solicitudId: convD.value.solicitudId, accept: true }, ctxEventual('uid-ev-d', cuilD)));
  report('aceptar una vencida no pasa', !tarde.ok && tarde.code === 'failed-precondition', tarde.message || '');
  const otraVezD = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilD }, ctxSuper()));
  report('vencida no bloquea una nueva convocatoria', otraVezD.ok === true, otraVezD.message || '');
  const noVencidas = await vencerConvocatoriasEventualesEvento();
  const solA4 = (await db.collection('solicitudes_evento').doc(conv.value.solicitudId).get()).data() || {};
  report('el barrido no toca aprobadas ni convocadas vigentes', noVencidas === 0 && solA4.status === 'aprobada', `n=${noVencidas}`);

  // ── 5) Switch «Exigir contrato marco y habilitación» ──
  const sinMarco = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilB }, ctxSuper()));
  report('sin marco ni empresa habilitada no se convoca (switch ON)', !sinMarco.ok && sinMarco.code === 'failed-precondition', sinMarco.message || '');
  const sinPermiso = await intentar(() => gestionarEventual.run({ accion: 'switchesPruebas', cuil: cuilB, exigirMarco: false }, ctxRol('uid-lector')));
  report('el switch exige EVENTUALES update (lector: permission-denied)', !sinPermiso.ok && sinPermiso.code === 'permission-denied', sinPermiso.message || '');
  const sw1 = await intentar(() => gestionarEventual.run({ accion: 'switchesPruebas', cuil: cuilB, exigirMarco: false }, ctxSuper('uid-rrhh')));
  const bolsaB = (await db.collection('eventuales_bolsa').doc(cuilB).get()).data() || {};
  const audSw = await db.collection('audit_logs').where('action', '==', 'EVENTUAL_SWITCH_PRUEBAS').get();
  report('switch marco OFF se guarda en la bolsa con audit_logs', sw1.ok && bolsaB.exigirMarco === false && bolsaB.exigirAltaArca !== false && bolsaB.switchesPruebasPor === 'uid-rrhh' && audSw.size === 1, sw1.ok ? `exigirMarco=${bolsaB.exigirMarco}` : sw1.message);
  const convB = await intentar(() => convocarEventualEvento.run({ ...base, cuil: cuilB }, ctxSuper()));
  const solB = convB.ok ? (await db.collection('solicitudes_evento').doc(convB.value.solicitudId).get()).data() : null;
  report(
    'switch OFF: convocable sin marco, marcado «Pruebas: sin exigir marco»',
    convB.ok && convB.value?.pruebasSinMarco === true && solB?.status === 'convocado' && solB?.pruebasSinMarco === true && solB?.exigirMarco === false
      && (solB?.etiquetasPruebas || []).includes('Pruebas: sin exigir marco') && solB?.anexoEstado === 'NO_EXIGIDO',
    convB.ok ? `anexo=${solB?.anexoEstado}` : convB.message,
  );
  const aceptaB = await intentar(() => respondEventoConvocatoria.run({ solicitudId: convB.value?.solicitudId || 'x', accept: true }, ctxEventual('uid-ev-b', cuilB)));
  const solB2 = (await db.collection('solicitudes_evento').doc(convB.value?.solicitudId || 'x').get()).data() || {};
  const turnoB = (await docsDe('turnos', cuilB))[0] || {};
  const contratoB = (await docsDe('contratos_eventuales', cuilB))[0] || {};
  const arcaB = (await docsDe('arca_envios', cuilB)).find((e) => e.tipo === 'AT') || {};
  const codigoB = solB2.contratoId ? await db.collection('anexo_codigos').doc(solB2.contratoId).get() : null;
  report(
    'switch OFF: acepta → EV + contrato + AT, sin anexo (no exigido)',
    aceptaB.ok && turnoB.code === 'EV' && turnoB.eventualExigirAltaArca === true && contratoB.estado === 'CONFIRMADO' && arcaB.tipo === 'AT'
      && solB2.status === 'aprobada' && solB2.anexoEstado === 'NO_EXIGIDO' && !(codigoB?.exists),
    aceptaB.ok ? `anexo=${solB2.anexoEstado} AT=${arcaB.canal}` : aceptaB.message,
  );
  const fichaB = await intentar(() => registrarPresencia(db, { shiftId: turnoB.id, empId: turnoB.employeeId, source: 'OPERATIONS', recordedAt: new Date().toISOString() }));
  report('switch marco OFF no apaga la regla de alta ARCA: fichada bloqueada', !fichaB.ok && fichaB.message === 'ALTA_ARCA_PENDIENTE', fichaB.message || 'fichó');

  // ── 6) Switch «Exigir alta ARCA para fichar» ──
  const sw2 = await intentar(() => gestionarEventual.run({ accion: 'switchesPruebas', cuil: cuilB, exigirAltaArca: false }, ctxSuper('uid-rrhh')));
  const turnoB2 = (await db.collection('turnos').doc(turnoB.id).get()).data() || {};
  report('switch ARCA OFF se propaga a los turnos vigentes del eventual', sw2.ok && sw2.value?.turnosActualizados >= 1 && turnoB2.eventualExigirAltaArca === false && turnoB2.eventualAltaArcaConfirmada === false, sw2.ok ? `turnos=${sw2.value?.turnosActualizados}` : sw2.message);
  const ventanaB = evaluateServerCheckInWindow({ id: turnoB.id, ...turnoB2 }, Date.now(), { source: 'OPERATIONS' });
  const fichaB2 = await intentar(() => registrarPresencia(db, { shiftId: turnoB.id, empId: turnoB.employeeId, source: 'OPERATIONS', recordedAt: new Date().toISOString() }));
  const turnoB3 = (await db.collection('turnos').doc(turnoB.id).get()).data() || {};
  report('switch ARCA OFF: ficha sin nro de transacción', ventanaB.allowed === true && fichaB2.ok && fichaB2.value?.success === true && turnoB3.isPresent === true && !turnoB3.nroTransaccion, fichaB2.ok ? `present=${turnoB3.isPresent}` : fichaB2.message);
  const swBack = await intentar(() => gestionarEventual.run({ accion: 'switchesPruebas', cuil: cuilB, exigirMarco: true, exigirAltaArca: true }, ctxSuper('uid-rrhh')));
  const bolsaB2 = (await db.collection('eventuales_bolsa').doc(cuilB).get()).data() || {};
  report('volver a ON deja la bolsa sin marcas de pruebas', swBack.ok && bolsaB2.exigirMarco === true && bolsaB2.exigirAltaArca === true, swBack.message || '');
  const swMal = await intentar(() => gestionarEventual.run({ accion: 'switchesPruebas', cuil: cuilB, exigirMarco: 'no' }, ctxSuper('uid-rrhh')));
  report('valor no booleano se rechaza', !swMal.ok, swMal.message || '');

  // ── Eventual que no va: antes del AT, después del AT, falta sin aviso ──
  const cuilSig = '20999999991';
  const cuilAntes = '20555555555';
  const cuilDespues = '20666666664';
  const cuilFalta = '20777777773';
  await db.collection('eventuales_bolsa').doc(cuilSig).set({ ...bolsa(cuilSig, { nombre: 'Siguiente, Max', uid: 'uid-ev-sig' }), confiabilidad: 100 });
  await db.collection('eventuales_bolsa').doc(cuilAntes).set(bolsa(cuilAntes, { nombre: 'Antes, Ana', uid: 'uid-ev-antes' }));
  await db.collection('eventuales_bolsa').doc(cuilDespues).set(bolsa(cuilDespues, { nombre: 'Despues, Leo', uid: 'uid-ev-despues' }));
  await db.collection('eventuales_bolsa').doc(cuilFalta).set(bolsa(cuilFalta, { nombre: 'Falta, Rui', uid: 'uid-ev-falta' }));
  const evento2 = { eventoId: 'evento-2', eventoNombre: 'Feria', servicioId: 'srv-feria', servicioNombre: 'Puerta' };

  async function aceptar(cuil, uid, jornada) {
    const conv = await convocarEventualEvento.run({ empresaId, evento: evento2, jornada, clientName: 'Cliente', positionName: 'Puerta', cuil }, ctxSuper());
    const acep = await respondEventoConvocatoria.run({ solicitudId: conv.solicitudId, accept: true }, ctxEventual(uid, cuil));
    const sol = (await db.collection('solicitudes_evento').doc(conv.solicitudId).get()).data() || {};
    const turno = (await docsDe('turnos', cuil))[0] || {};
    return { conv, acep, sol, turno };
  }
  async function confirmarAt(cuil) {
    const at = (await docsDe('arca_envios', cuil)).find((e) => e.tipo === 'AT' && !e.quitadoDelLote);
    const nro = `TX-${cuil.slice(-4)}`;
    await db.collection('arca_envios').doc(at.id).update({ estado: 'CONFIRMADO', nroTransaccion: nro, origen: 'MANUAL' });
    const luego = (await db.collection('arca_envios').doc(at.id).get()).data() || {};
    return { at, luego };
  }
  async function convocatoriaDelHueco(shiftId, cuil) {
    const snap = await db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).get();
    return snap.docs.map((d) => d.data()).find((c) => c.status === 'PENDING' && c.type === 'EVENTUAL' && c.bolsaCuil !== cuil) || null;
  }

  const antes = await aceptar(cuilAntes, 'uid-ev-antes', jornadaDesde(Date.now() + 48 * 3600000, 6));
  const noVaAntes = await intentar(() => noPuedoAsistirEventual.run({ solicitudId: antes.conv.solicitudId }, ctxEventual('uid-ev-antes', cuilAntes)));
  const solAntes = (await db.collection('solicitudes_evento').doc(antes.conv.solicitudId).get()).data() || {};
  const turnoAntes = (await db.collection('turnos').doc(antes.turno.id).get()).data() || {};
  const atAntes = (await docsDe('arca_envios', cuilAntes)).find((e) => e.tipo === 'AT') || {};
  const anulaAntes = (await docsDe('arca_envios', cuilAntes)).some((e) => e.tipo === 'ANULACION');
  const desemAntes = (await db.collection('guardia_desempeno_eventos').doc(`CANCELACION_ANTICIPADA_${antes.turno.id}_${cuilAntes}`).get()).data() || {};
  const sigAntes = await convocatoriaDelHueco(antes.turno.id, cuilAntes);
  report(
    'no puedo asistir antes del AT: cancela alta, anexo sin efecto, reconvoca',
    noVaAntes.ok && solAntes.status === 'cancelada' && solAntes.anexoEstado === 'SIN_EFECTO' && atAntes.quitadoDelLote === true && !anulaAntes
      && turnoAntes.employeeId === 'VACANTE' && turnoAntes.pagaJornada === false && desemAntes.tipo === 'CANCELACION_ANTICIPADA' && desemAntes.bolsaCuil === cuilAntes
      && sigAntes?.bolsaCuil === cuilSig,
    noVaAntes.ok ? `anexo=${solAntes.anexoEstado} sig=${sigAntes?.bolsaCuil}` : noVaAntes.message,
  );

  const despues = await aceptar(cuilDespues, 'uid-ev-despues', jornadaDesde(Date.now() + 2 * 3600000, 6));
  const confDespues = await confirmarAt(cuilDespues);
  const noVaDespues = await intentar(() => noPuedoAsistirEventual.run({ solicitudId: despues.conv.solicitudId }, ctxEventual('uid-ev-despues', cuilDespues)));
  const anula = (await docsDe('arca_envios', cuilDespues)).find((e) => e.tipo === 'ANULACION') || {};
  const solDespues = (await db.collection('solicitudes_evento').doc(despues.conv.solicitudId).get()).data() || {};
  const desemDespues = (await db.collection('guardia_desempeno_eventos').doc(`CANCELACION_TARDIA_${despues.turno.id}_${cuilDespues}`).get()).data() || {};
  const sigDespues = await convocatoriaDelHueco(despues.turno.id, cuilDespues);
  report(
    'no puedo asistir con AT ya subido: anulación urgente sin remuneración',
    confDespues.luego.estado === 'CONFIRMADO' && noVaDespues.ok && anula.tipo === 'ANULACION' && anula.canal === 'URGENTE' && anula.movimiento == null && anula.bruto === 0
      && anula.lote === 'ANULACION' && anula.modulo === 'ANULACION_INCORPORACIONES' && anula.motivo == null && anula.revista == null
      && solDespues.anexoEstado === 'SIN_EFECTO' && desemDespues.tipo === 'CANCELACION_TARDIA' && sigDespues?.bolsaCuil === cuilSig,
    noVaDespues.ok ? `mov=${anula.movimiento} canal=${anula.canal}` : noVaDespues.message,
  );

  const inicioFalta = inicioConAnulacionVencida(Date.now(), 6);
  const falta = await aceptar(cuilFalta, 'uid-ev-falta', inicioFalta.jornada);
  const confFalta = await confirmarAt(cuilFalta);
  const noVaTarde = await intentar(() => noPuedoAsistirEventual.run({ solicitudId: falta.conv.solicitudId }, ctxEventual('uid-ev-falta', cuilFalta)));
  const marcada = await markShiftAbsent(db, falta.turno.id, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
  const turnoFalta = (await db.collection('turnos').doc(falta.turno.id).get()).data() || {};
  const baja = (await docsDe('arca_envios', cuilFalta)).find((e) => e.tipo === 'BAJA_NO_PRESENTACION') || {};
  const novedad = (await db.collection('novedades').where('shiftId', '==', falta.turno.id).get()).docs.map((d) => d.data()).find((n) => n.type === 'AUSENCIA_EVENTUAL');
  const desemFalta = (await db.collection('guardia_desempeno_eventos').doc(`FALTA_SIN_AVISO_${falta.turno.id}_${cuilFalta}`).get()).data() || {};
  const sigFalta = await convocatoriaDelHueco(falta.turno.id, cuilFalta);
  const fechaInicio = String(turnoFalta.scheduleDate || '');
  report(
    'falta sin aviso: no se paga, baja el día de inicio, aviso a RRHH',
    noVaTarde.ok === false && confFalta.luego.estado === 'CONFIRMADO' && marcada.applied === true && turnoFalta.isAbsent === true && turnoFalta.pagaJornada === false
      && baja.tipo === 'BAJA_NO_PRESENTACION' && baja.canal === 'URGENTE' && baja.fechaBaja === fechaInicio && baja.revista === '30'
      && baja.motivo === 'desistimiento / sin efectivización de tareas' && baja.constanciaInterna === 'NO_SE_PRESENTO'
      && String(baja.txt || '').slice(2, 4) === 'BT' && String(baja.txt || '').slice(45, 47) === '30'
      && !!novedad && desemFalta.tipo === 'FALTA_SIN_AVISO' && desemFalta.empleadoId === falta.turno.employeeId && sigFalta?.bolsaCuil === cuilSig,
    `inicio=${inicioFalta.jornada.fecha} ${inicioFalta.jornada.horaInicio} tarde=${noVaTarde.message || ''} baja=${baja.tipo} fecha=${baja.fechaBaja} nov=${novedad ? 'si' : 'no'} sig=${sigFalta?.bolsaCuil}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
