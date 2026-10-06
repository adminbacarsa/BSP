/**
 * Consulta de disponibilidad en Planificación (uno a uno o uno a varios).
 * Colección `consultas_disponibilidad` + invitaciones. El primero que dice que sí
 * toma el lugar y se asigna por el mismo camino que `asignarEventualPlanificacion` (TURNOS).
 * El eventual responde por callable; Firestore no acepta escritura del cliente.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { asignarTurnosDeConsulta, exigirPuedeConsultar, prevalidarEventualConsulta } from './planificacionEventuales';
import { asignarGuardiaDeConsulta, crearConsultaGuardias } from './consultaGuardiaServer';

const AR_OFFSET = '-03:00';
const COL = 'consultas_disponibilidad';
const INV = 'consultas_disponibilidad_invitaciones';

type JornadaIn = { fecha: string; horaInicio: string; horaFin: string; horas?: number; code?: string; name?: string; positionName?: string };
type RespuestaVista = { cuil: string; employeeId?: string | null; tipo?: string | null; nombre: string; estado: string; orden: number | null; hora: string | null; motivo: string | null };
type PersonaConsulta = { tipo: 'EVENTUAL' | 'GUARDIA'; cuil: string; employeeId: string | null };

type LibConsulta = {
  textoConsulta: (p: { cliente?: string | null; objetivo?: string | null; puesto?: string | null; jornadas: JornadaIn[] }) => string;
  huecoKeyDe: (p: { empresaId: string; objectiveId?: string | null; positionName?: string | null; jornadas: JornadaIn[] }) => string;
  venceEnMs: (p: { ahoraMs: number; minutos: number; inicioPrimerTurnoMs: number | null }) => number;
  reservarLugar: (p: { lugares: number; tomados: number; status: string; venceAtMs: number; ahoraMs: number; estadoInvitacion: string }) => { ok: boolean; codigo?: string; orden?: number | null; idempotente?: boolean };
  textoEstadoConsulta: (respuestas: RespuestaVista[]) => string;
  tomadosTrasNoElegible: (respuestas: RespuestaVista[], cuil: string) => number;
  debeVencer: (p: { status: string; ahoraMs: number; venceAtMs: number }) => boolean;
  MENSAJE_CUBIERTO: string;
};

function db() {
  return admin.firestore();
}

async function lib(): Promise<LibConsulta> {
  return import('../eventuales-shared/consultaDisponibilidad.mjs') as Promise<LibConsulta>;
}

function validarJornada(j: Partial<JornadaIn> | null | undefined): j is JornadaIn {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(j?.fecha || ''))
    && /^\d{1,2}:\d{2}$/.test(String(j?.horaInicio || ''))
    && /^\d{1,2}:\d{2}$/.test(String(j?.horaFin || ''));
}

function inicioMs(jornadas: JornadaIn[]): number | null {
  const times = jornadas.map((j) => {
    const [h, m] = String(j.horaInicio).split(':').map(Number);
    return new Date(`${j.fecha}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00.000${AR_OFFSET}`).getTime();
  }).filter((n) => Number.isFinite(n));
  return times.length ? Math.min(...times) : null;
}

function horaAr(ms: number): string {
  return new Date(ms - 3 * 3600000).toISOString().slice(11, 16);
}

function lugarDe(data: Record<string, unknown>): string {
  return [data.clientName, data.objectiveName, data.positionName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ') || 'el puesto';
}

async function evento(consultaId: string, tipo: string, extra: Record<string, unknown>) {
  await db().collection(COL).doc(consultaId).collection('eventos').add({
    tipo,
    atMs: Date.now(),
    at: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
}

async function auditar(action: string, actorUid: string, empresaId: string, details: string, extra: Record<string, unknown> = {}) {
  await db().collection('audit_logs').add({
    action,
    module: 'PLANNING',
    actorUid,
    actorName: actorUid,
    empresaId,
    details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
}

function invitacionRef(consultaId: string, cuil: string) {
  return db().collection(INV).doc(`${consultaId}_${cuil}`);
}

function mismaPersona(r: RespuestaVista, p: PersonaConsulta): boolean {
  if (p.tipo === 'GUARDIA') return r.tipo === 'GUARDIA' && String(r.employeeId || '') === String(p.employeeId || '');
  return r.tipo !== 'GUARDIA' && r.cuil === p.cuil;
}

function refDePersona(consultaId: string, p: PersonaConsulta) {
  if (p.tipo === 'GUARDIA' && p.employeeId) return db().collection(INV).doc(`${consultaId}_emp_${p.employeeId}`);
  return invitacionRef(consultaId, p.cuil);
}

function personaDeRespuesta(r: RespuestaVista): PersonaConsulta {
  if (r.tipo === 'GUARDIA' && r.employeeId) return { tipo: 'GUARDIA', cuil: '', employeeId: String(r.employeeId) };
  return { tipo: 'EVENTUAL', cuil: r.cuil, employeeId: r.employeeId ? String(r.employeeId) : null };
}

export const crearConsultaDisponibilidad = functions.https.onCall(async (data, context) => {
  if (Array.isArray(data?.guardias) && data.guardias.length > 0) return crearConsultaGuardias(data, context);
  const auth = await exigirPuedeConsultar(context);
  const reglas = await lib();
  const empresaId = String(data?.empresaId || '');
  const jornadas = ((data?.jornadas || []) as Partial<JornadaIn>[]).filter(validarJornada);
  const cuils = [...new Set(((data?.cuils || []) as unknown[]).map((c) => String(c || '').replace(/\D/g, '')).filter((c) => c.length === 11))];
  if (!empresaId || !jornadas.length) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o jornadas.');
  if (!cuils.length) throw new functions.https.HttpsError('invalid-argument', 'Elegí al menos un eventual.');
  if (cuils.length > 30) throw new functions.https.HttpsError('invalid-argument', 'Máximo 30 eventuales por consulta.');
  const lugaresPedidos = Math.max(1, Math.min(Number(data?.lugares) || 1, cuils.length, 20));
  const clientId = data?.clientId ? String(data.clientId) : null;
  const objectiveId = data?.objectiveId ? String(data.objectiveId) : null;
  const clientName = data?.clientName ? String(data.clientName) : null;
  const objectiveName = data?.objectiveName ? String(data.objectiveName) : null;
  const positionName = data?.positionName ? String(data.positionName) : null;
  const jornadasNorm: JornadaIn[] = jornadas.map((j) => {
    const puesto = j.positionName || positionName || '';
    return {
      fecha: j.fecha, horaInicio: j.horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0,
      code: String(j.code || 'M').toUpperCase(),
      ...(j.name ? { name: j.name } : {}),
      ...(puesto ? { positionName: puesto } : {}),
    };
  });

  const elegibles: { cuil: string; nombre: string; uid: string; employeeId: string | null }[] = [];
  const omitidos: { cuil: string; motivo: string }[] = [];
  for (const cuil of cuils) {
    const ev = await prevalidarEventualConsulta({
      empresaId, cuil, jornadas: jornadasNorm.map((j) => ({ fecha: j.fecha, horaInicio: j.horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0 })),
      clientId, objectiveId, objetivoGeo: data?.objetivoGeo, actorUid: auth.uid,
    });
    if (!ev.elegible) omitidos.push({ cuil, motivo: ev.motivo || 'No elegible' });
    else elegibles.push({ cuil, nombre: ev.nombre, uid: ev.uid, employeeId: ev.employeeId });
  }
  if (!elegibles.length) throw new functions.https.HttpsError('failed-precondition', omitidos[0]?.motivo || 'Nadie quedó elegible.');
  const lugares = Math.min(lugaresPedidos, elegibles.length);
  const texto = reglas.textoConsulta({ cliente: clientName, objetivo: objectiveName, puesto: positionName, jornadas: jornadasNorm });
  const huecoKey = reglas.huecoKeyDe({ empresaId, objectiveId, positionName, jornadas: jornadasNorm });
  const ahora = Date.now();
  const venceAtMs = reglas.venceEnMs({ ahoraMs: ahora, minutos: Number(data?.venceMinutos), inicioPrimerTurnoMs: inicioMs(jornadasNorm) });
  const respuestas: RespuestaVista[] = elegibles.map((e) => ({ cuil: e.cuil, nombre: e.nombre, estado: 'PENDIENTE', orden: null, hora: null, motivo: null }));
  const ref = db().collection(COL).doc();
  const batch = db().batch();
  batch.set(ref, {
    empresaId, huecoKey, status: 'ABIERTA', lugares, tomados: 0,
    jornadas: jornadasNorm, cuils: elegibles.map((e) => e.cuil),
    clientId, clientName, objectiveId, objectiveName, positionName,
    objetivoGeo: data?.objetivoGeo || null,
    texto, venceAt: admin.firestore.Timestamp.fromMillis(venceAtMs), venceAtMs,
    ...(String(data?.titularEmployeeId || '').trim() ? { titularEmployeeId: String(data.titularEmployeeId).trim() } : {}),
    creadoPor: auth.uid, creadoPorNombre: String(auth.token.email || auth.uid),
    ...(String(data?.titularEmployeeId || '').trim() ? { titularEmployeeId: String(data.titularEmployeeId).trim() } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    respuestas, resumen: reglas.textoEstadoConsulta(respuestas),
  });
  for (const e of elegibles) {
    batch.set(invitacionRef(ref.id, e.cuil), {
      consultaId: ref.id, empresaId, bolsaCuil: e.cuil, uid: e.uid || null, employeeId: e.employeeId,
      nombre: e.nombre, estado: 'PENDIENTE', texto, jornadas: jornadasNorm,
      clientName, objectiveName, positionName, venceAtMs, huecoKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  await evento(ref.id, 'CREADA', { actorUid: auth.uid, lugares, cuils: elegibles.map((e) => e.cuil), venceAtMs });

  for (const e of elegibles) {
    if (e.uid) {
      await db().collection('user_notifications').add({
        uid: e.uid,
        employeeId: e.employeeId || null,
        empresaId,
        type: 'CONSULTA_DISPONIBILIDAD',
        target: 'employee',
        title: '¿Estás disponible?',
        body: texto,
        consultaId: ref.id,
        invitacionId: invitacionRef(ref.id, e.cuil).id,
        objectiveId, objectiveName, positionName, clientName,
        read: false,
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await evento(ref.id, 'PUSH', { bolsaCuil: e.cuil, uid: e.uid });
    } else {
      await evento(ref.id, 'PUSH', { bolsaCuil: e.cuil, resultado: 'SIN_UID' });
    }
  }
  await auditar('CONSULTA_DISPONIBILIDAD_CREADA', auth.uid, empresaId, `${elegibles.length} consultados · ${lugares} lugar/es · ${texto}`, { consultaId: ref.id, huecoKey });
  return { ok: true, consultaId: ref.id, lugares, consultados: elegibles.length, omitidos, resumen: reglas.textoEstadoConsulta(respuestas), venceAtMs };
});

async function marcarRespuesta(consultaId: string, persona: PersonaConsulta, patch: Partial<RespuestaVista>, estadoInv: string, extraInv: Record<string, unknown> = {}) {
  const reglas = await lib();
  const parentRef = db().collection(COL).doc(consultaId);
  await db().runTransaction(async (tx) => {
    const parent = await tx.get(parentRef);
    const data = parent.data() || {};
    const respuestas = ((data.respuestas || []) as RespuestaVista[]).map((r) => (mismaPersona(r, persona) ? { ...r, ...patch } : r));
    const tomados = respuestas.filter((r) => r.estado === 'ASIGNADO' || r.estado === 'RESERVADO').length;
    tx.update(parentRef, { respuestas, tomados, resumen: reglas.textoEstadoConsulta(respuestas) });
    tx.update(refDePersona(consultaId, persona), { estado: estadoInv, ...extraInv });
  });
}

async function cerrarSiCompleta(consultaId: string, actorUid: string) {
  const reglas = await lib();
  const parentRef = db().collection(COL).doc(consultaId);
  const snap = await parentRef.get();
  const data = snap.data() || {};
  if (String(data.status) !== 'ABIERTA') return;
  const respuestas = (data.respuestas || []) as RespuestaVista[];
  const asignados = respuestas.filter((r) => r.estado === 'ASIGNADO').length;
  if (asignados < Number(data.lugares || 0)) return;
  const pendientes = respuestas.filter((r) => r.estado === 'PENDIENTE');
  const cerradas = respuestas.map((r) => (r.estado === 'PENDIENTE' ? { ...r, estado: 'CUBIERTO', motivo: reglas.MENSAJE_CUBIERTO } : r));
  await parentRef.update({
    status: 'COMPLETA',
    tomados: asignados,
    respuestas: cerradas,
    resumen: reglas.textoEstadoConsulta(cerradas),
    venceAt: admin.firestore.FieldValue.delete(),
    cerradaAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  for (const p of pendientes) {
    const inv = refDePersona(consultaId, personaDeRespuesta(p));
    const invSnap = await inv.get();
    await inv.update({ estado: 'CUBIERTO', motivo: reglas.MENSAJE_CUBIERTO, venceAtMs: null });
    const uid = String(invSnap.data()?.uid || '');
    if (uid) {
      await db().collection('user_notifications').add({
        uid,
        employeeId: invSnap.data()?.employeeId || null,
        empresaId: data.empresaId || null,
        type: 'CONSULTA_CUBIERTA',
        target: 'employee',
        title: 'Cupo completo',
        body: reglas.MENSAJE_CUBIERTO,
        consultaId,
        invitacionId: inv.id,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
  await evento(consultaId, 'CERRADA', { actorUid, asignados });
  await auditar('CONSULTA_DISPONIBILIDAD_CERRADA', actorUid, String(data.empresaId || ''), `Consulta cubierta (${asignados}/${data.lugares}).`, { consultaId });
}

export const responderConsultaDisponibilidad = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const reglas = await lib();
  const invitacionId = String(data?.invitacionId || '');
  const respuesta = String(data?.respuesta || '').toUpperCase() === 'SI' ? 'SI' : String(data?.respuesta || '').toUpperCase() === 'NO' ? 'NO' : '';
  if (!invitacionId || !respuesta) throw new functions.https.HttpsError('invalid-argument', 'Falta la consulta o la respuesta.');
  const invRef = db().collection(INV).doc(invitacionId);
  const invSnap = await invRef.get();
  if (!invSnap.exists) throw new functions.https.HttpsError('not-found', 'No encontramos la consulta.');
  const inv = invSnap.data() || {};
  const uid = context.auth.uid;
  const claimCuil = String(context.auth.token.bolsaCuil || '').replace(/\D/g, '');
  const propio = (inv.uid && inv.uid === uid) || (claimCuil && claimCuil === String(inv.bolsaCuil || ''));
  if (!propio) throw new functions.https.HttpsError('permission-denied', 'Esta consulta no es tuya.');
  const consultaId = String(inv.consultaId || '');
  const esGuardia = String(inv.tipo || '') === 'GUARDIA';
  const cuil = String(inv.bolsaCuil || '');
  const persona: PersonaConsulta = esGuardia
    ? { tipo: 'GUARDIA', cuil: '', employeeId: String(inv.employeeId || '') }
    : { tipo: 'EVENTUAL', cuil, employeeId: inv.employeeId ? String(inv.employeeId) : null };
  const quien = esGuardia ? String(inv.employeeId || '') : cuil;
  const parentRef = db().collection(COL).doc(consultaId);

  if (respuesta === 'NO') {
    if (inv.estado === 'NO') return { ok: true, idempotente: true, codigo: 'NO' };
    if (inv.estado !== 'PENDIENTE') return { ok: false, codigo: 'YA_RESPONDIO' };
    const hora = horaAr(Date.now());
    await marcarRespuesta(consultaId, persona, { estado: 'NO', hora, motivo: null }, 'NO', { respondioAt: admin.firestore.FieldValue.serverTimestamp() });
    await evento(consultaId, 'RESPUESTA', { bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, respuesta: 'NO', hora, uid });
    await auditar('CONSULTA_DISPONIBILIDAD_RESPUESTA', uid, String(inv.empresaId || ''), `${inv.nombre || quien} no puede.`, { consultaId, bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId });
    return { ok: true, codigo: 'NO' };
  }

  if (inv.estado === 'ASIGNADO' || (Array.isArray(inv.turnoIds) && inv.turnoIds.length > 0)) {
    return { ok: true, idempotente: true, codigo: 'ASIGNADO', orden: inv.orden || null };
  }

  const reserva = await db().runTransaction(async (tx) => {
    const parent = await tx.get(parentRef);
    const actual = await tx.get(invRef);
    const pdata = parent.data() || {};
    const idata = actual.data() || {};
    const decision = reglas.reservarLugar({
      lugares: Number(pdata.lugares || 0),
      tomados: Number(pdata.tomados || 0),
      status: String(pdata.status || ''),
      venceAtMs: Number(pdata.venceAtMs || 0),
      ahoraMs: Date.now(),
      estadoInvitacion: String(idata.estado || ''),
    });
    if (!decision.ok || decision.idempotente) return { decision, pdata };
    const hora = horaAr(Date.now());
    const respuestas = ((pdata.respuestas || []) as RespuestaVista[]).map((r) => (
      mismaPersona(r, persona) ? { ...r, estado: 'RESERVADO', orden: decision.orden ?? null, hora } : r
    ));
    tx.update(parentRef, {
      tomados: decision.orden,
      ultimaReservaAt: admin.firestore.FieldValue.serverTimestamp(),
      respuestas,
      resumen: reglas.textoEstadoConsulta(respuestas),
    });
    tx.update(invRef, { estado: 'RESERVADO', orden: decision.orden, respondioAt: admin.firestore.FieldValue.serverTimestamp() });
    return { decision, pdata, hora };
  });

  if (!reserva.decision.ok) return { ok: false, codigo: reserva.decision.codigo || 'CERRADA' };
  if (reserva.decision.idempotente && String(inv.estado) === 'ASIGNADO') return { ok: true, idempotente: true, codigo: 'ASIGNADO' };
  await evento(consultaId, 'RESPUESTA', { bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, respuesta: 'SI', hora: reserva.hora, orden: reserva.decision.orden, uid });

  const jornadas = (reserva.pdata.jornadas || inv.jornadas || []) as JornadaIn[];
  try {
    const empresa = String(reserva.pdata.empresaId || inv.empresaId || '');
    const asignado = esGuardia
      ? await asignarGuardiaDeConsulta({
        empresaId: empresa,
        employeeId: String(inv.employeeId || ''),
        nombre: String(inv.nombre || ''),
        tipo: (String(inv.cobertura || 'FT').toUpperCase() as 'FT' | 'RET' | 'LIBRE'),
        jornadas,
        objectiveId: reserva.pdata.objectiveId ? String(reserva.pdata.objectiveId) : null,
        objectiveName: reserva.pdata.objectiveName ? String(reserva.pdata.objectiveName) : null,
        clientId: reserva.pdata.clientId ? String(reserva.pdata.clientId) : null,
        clientName: reserva.pdata.clientName ? String(reserva.pdata.clientName) : null,
        positionName: reserva.pdata.positionName ? String(reserva.pdata.positionName) : null,
        cubreEmployeeId: reserva.pdata.cubreEmployeeId ? String(reserva.pdata.cubreEmployeeId) : null,
        cubreNombre: reserva.pdata.cubreNombre ? String(reserva.pdata.cubreNombre) : null,
        autorizaciones: (reserva.pdata.autorizaciones || []) as { employeeId: string; kind: 'DESCANSO' | 'TOPE'; motivo: string }[],
        actorName: String(reserva.pdata.creadoPorNombre || uid),
      })
      : await asignarTurnosDeConsulta({
        empresaId: empresa,
        cuil,
        turnos: jornadas.map((j) => ({
          fecha: j.fecha, horaInicio: j.horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0,
          code: String(j.code || 'M'), name: j.name, positionName: j.positionName || String(reserva.pdata.positionName || ''),
        })),
        objectiveId: reserva.pdata.objectiveId ? String(reserva.pdata.objectiveId) : null,
        objectiveName: reserva.pdata.objectiveName ? String(reserva.pdata.objectiveName) : null,
        clientId: reserva.pdata.clientId ? String(reserva.pdata.clientId) : null,
        clientName: reserva.pdata.clientName ? String(reserva.pdata.clientName) : null,
        positionName: reserva.pdata.positionName ? String(reserva.pdata.positionName) : null,
        objetivoGeo: reserva.pdata.objetivoGeo,
        actorUid: String(reserva.pdata.creadoPor || uid),
        actorName: String(reserva.pdata.creadoPorNombre || uid),
      });
    await marcarRespuesta(consultaId, persona, { estado: 'ASIGNADO', orden: reserva.decision.orden ?? null, hora: reserva.hora || null, motivo: null }, 'ASIGNADO', { turnoIds: asignado.turnoIds, employeeId: asignado.employeeId });
    await evento(consultaId, 'ASIGNADO', { bolsaCuil: esGuardia ? null : cuil, employeeId: asignado.employeeId, orden: reserva.decision.orden, turnoIds: asignado.turnoIds });
    await auditar('CONSULTA_DISPONIBILIDAD_ASIGNADO', uid, empresa, `${asignado.nombre} tomó el lugar ${reserva.decision.orden}.`, { consultaId, bolsaCuil: esGuardia ? null : cuil, employeeId: asignado.employeeId, turnoIds: asignado.turnoIds });
    await cerrarSiCompleta(consultaId, uid);
    return { ok: true, codigo: 'ASIGNADO', orden: reserva.decision.orden, turnoIds: asignado.turnoIds };
  } catch (e) {
    const motivo = e instanceof functions.https.HttpsError ? e.message : 'Ya no es elegible.';
    const parent = await parentRef.get();
    const respuestas = ((parent.data()?.respuestas || []) as RespuestaVista[]).map((r) => (
      mismaPersona(r, persona) ? { ...r, estado: 'NO_ELEGIBLE', motivo, orden: null } : r
    ));
    const tomados = respuestas.filter((r) => !mismaPersona(r, persona) && (r.estado === 'ASIGNADO' || r.estado === 'RESERVADO')).length;
    await parentRef.update({ respuestas, tomados, resumen: reglas.textoEstadoConsulta(respuestas), status: 'ABIERTA' });
    await invRef.update({ estado: 'NO_ELEGIBLE', motivo, orden: null });
    await evento(consultaId, 'RESPUESTA', { bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, respuesta: 'NO_ELEGIBLE', motivo, uid });
    await auditar('CONSULTA_DISPONIBILIDAD_NO_ELEGIBLE', uid, String(reserva.pdata.empresaId || ''), `${inv.nombre || quien}: ${motivo}. El lugar sigue libre.`, { consultaId, bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId });
    return { ok: false, codigo: 'NO_ELEGIBLE', motivo };
  }
});

const MENSAJE_YA_NO_HACE_FALTA = 'Ya no hace falta';

/** Cierra una consulta abierta y avisa a los que todavía no respondieron. */
export const cancelarConsultaDisponibilidad = functions.https.onCall(async (data, context) => {
  const auth = await exigirPuedeConsultar(context);
  const consultaId = String(data?.consultaId || '').trim();
  if (!consultaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la consulta.');
  const ref = db().collection(COL).doc(consultaId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No existe la consulta.');
  const parent = snap.data() || {};
  if (data?.empresaId && String(parent.empresaId || '') !== String(data.empresaId)) {
    throw new functions.https.HttpsError('permission-denied', 'La consulta es de otra empresa.');
  }
  if (String(parent.status || '') !== 'ABIERTA') return { ok: true, codigo: 'YA_CERRADA', status: parent.status || null };
  const respuestas = ((parent.respuestas || []) as RespuestaVista[]).map((r) => (
    r.estado === 'PENDIENTE' || r.estado === 'RESERVADO'
      ? { ...r, estado: 'CANCELADA', motivo: MENSAJE_YA_NO_HACE_FALTA, orden: null }
      : r
  ));
  await ref.update({
    status: 'CERRADA',
    venceAt: admin.firestore.FieldValue.delete(),
    canceladaAt: admin.firestore.FieldValue.serverTimestamp(),
    canceladaPor: auth.uid,
    respuestas,
    resumen: `Cancelada: ${MENSAJE_YA_NO_HACE_FALTA}`,
  });
  for (const r of (parent.respuestas || []) as RespuestaVista[]) {
    if (r.estado !== 'PENDIENTE' && r.estado !== 'RESERVADO') continue;
    const inv = invitacionRef(consultaId, r.cuil);
    const invSnap = await inv.get();
    const uid = invSnap.exists ? String(invSnap.data()?.uid || '') : '';
    const employeeId = invSnap.exists ? (invSnap.data()?.employeeId || null) : null;
    if (invSnap.exists) await inv.update({ estado: 'CANCELADA', motivo: MENSAJE_YA_NO_HACE_FALTA, orden: null });
    if (uid) {
      await db().collection('user_notifications').add({
        uid,
        employeeId,
        empresaId: parent.empresaId || null,
        type: 'CONSULTA_DISPONIBILIDAD',
        target: 'employee',
        title: MENSAJE_YA_NO_HACE_FALTA,
        body: MENSAJE_YA_NO_HACE_FALTA,
        consultaId,
        objectiveId: parent.objectiveId || null,
        objectiveName: parent.objectiveName || null,
        positionName: parent.positionName || null,
        read: false,
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
  await evento(consultaId, 'CANCELADA', { actorUid: auth.uid });
  await auditar('CONSULTA_DISPONIBILIDAD_CANCELADA', auth.uid, String(parent.empresaId || ''), 'Consulta cancelada: ya no hace falta.', { consultaId });
  return { ok: true, codigo: 'CERRADA' };
});

/** La corre el scheduler de convocatorias: vence las abiertas y avisa al planificador si quedó lugar. */
export async function vencerConsultasDisponibilidad(now: admin.firestore.Timestamp): Promise<number> {
  const reglas = await lib();
  const snap = await db().collection(COL).where('venceAt', '<=', now).limit(40).get();
  let n = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (!reglas.debeVencer({ status: String(data.status || ''), ahoraMs: now.toMillis(), venceAtMs: Number(data.venceAtMs || data.venceAt?.toMillis?.() || 0) })) continue;
    await doc.ref.update({
      status: 'VENCIDA',
      venceAt: admin.firestore.FieldValue.delete(),
      vencidaAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await evento(doc.id, 'VENCIDA', { tomados: data.tomados || 0, lugares: data.lugares || 0 });
    const tomados = Number(data.tomados || 0);
    const lugares = Number(data.lugares || 0);
    if (tomados < lugares) {
      await db().collection('novedades').add({
        type: 'CONSULTA_DISPONIBILIDAD_VENCIDA',
        status: 'PENDIENTE',
        empresaId: data.empresaId || null,
        objectiveId: data.objectiveId || null,
        objectiveName: data.objectiveName || null,
        positionName: data.positionName || null,
        clientName: data.clientName || null,
        description: `La consulta de disponibilidad en ${lugarDe(data)} venció con ${tomados} de ${lugares} lugares cubiertos.`,
        createdAt: admin.firestore.Timestamp.now(),
        source: 'PLANIFICACION',
        consultaId: doc.id,
      });
    }
    await auditar('CONSULTA_DISPONIBILIDAD_VENCIDA', 'SISTEMA', String(data.empresaId || ''), `Consulta vencida ${tomados}/${lugares}.`, { consultaId: doc.id });
    n += 1;
  }
  return n;
}
