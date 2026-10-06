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
import { MailNotConfiguredError, sendSystemMail } from '../common/mailer';
import { aplicarEntregasConsulta, type DestinoEntrega } from './consultaCanalServer';

const AR_OFFSET = '-03:00';
const COL = 'consultas_disponibilidad';
const INV = 'consultas_disponibilidad_invitaciones';

type JornadaIn = { fecha: string; horaInicio: string; horaFin: string; horas?: number; code?: string; name?: string; positionName?: string };
type RespuestaVista = { cuil: string; employeeId?: string | null; tipo?: string | null; nombre: string; estado: string; orden: number | null; hora: string | null; motivo: string | null; entregaNota?: string | null };
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
  cierreDeConsulta: (status: string) => { estado: string; motivo: string; avisar: boolean; tipoAviso: string | null; linea: string | null } | null;
  invitacionHayQueCerrarla: (estado: unknown) => boolean;
  mensajeRespuestaCerrada: (estado: string, status: string, codigo: string) => string;
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

function esperaRespuesta(estado: unknown): boolean {
  const e = String(estado || '');
  return e === 'PENDIENTE' || e === 'AVISO_MAIL';
}

/** Al crear el acceso a la app, las consultas abiertas de esa persona pasan a tener uid. */
export async function completarUidInvitacionesAbiertas(input: {
  uid: string;
  bolsaCuil?: string | null;
  employeeIds?: string[] | null;
}): Promise<number> {
  const uid = String(input.uid || '').trim();
  if (!uid) return 0;
  const seen = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  const cuil = String(input.bolsaCuil || '').replace(/\D/g, '');
  if (cuil) {
    const snap = await db().collection(INV).where('bolsaCuil', '==', cuil).get();
    snap.docs.forEach((d) => seen.set(d.id, d));
  }
  for (const raw of input.employeeIds || []) {
    const emp = String(raw || '').trim();
    if (!emp) continue;
    const snap = await db().collection(INV).where('employeeId', '==', emp).get();
    snap.docs.forEach((d) => seen.set(d.id, d));
  }
  const abiertas = [...seen.values()].filter((d) => {
    const data = d.data();
    return esperaRespuesta(data.estado) && String(data.uid || '') !== uid;
  });
  let n = 0;
  for (let i = 0; i < abiertas.length; i += 400) {
    const batch = db().batch();
    abiertas.slice(i, i + 400).forEach((d) => batch.update(d.ref, { uid }));
    await batch.commit();
    n += Math.min(400, abiertas.length - i);
  }
  return n;
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

  const elegibles: { cuil: string; nombre: string; uid: string; employeeId: string | null; mail: string; pushEstado: string }[] = [];
  const omitidos: { cuil: string; motivo: string }[] = [];
  for (const cuil of cuils) {
    const ev = await prevalidarEventualConsulta({
      empresaId, cuil, jornadas: jornadasNorm.map((j) => ({ fecha: j.fecha, horaInicio: j.horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0 })),
      clientId, objectiveId, objetivoGeo: data?.objetivoGeo, actorUid: auth.uid,
    });
    if (!ev.elegible) omitidos.push({ cuil, motivo: ev.motivo || 'No elegible' });
    else elegibles.push({ cuil, nombre: ev.nombre, uid: ev.uid, employeeId: ev.employeeId, mail: ev.mail, pushEstado: ev.pushEstado });
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

  const destinos: DestinoEntrega[] = elegibles.map((e) => ({
    invitacionId: invitacionRef(ref.id, e.cuil).id,
    nombre: e.nombre,
    uid: e.uid,
    mail: e.mail,
    pushEstado: e.pushEstado,
    employeeId: e.employeeId,
    bolsaCuil: e.cuil,
    texto,
    cuil: e.cuil,
    tipo: 'EVENTUAL',
  }));
  const entrega = await aplicarEntregasConsulta({
    consultaId: ref.id, empresaId, actorUid: auth.uid,
    objectiveId, objectiveName, positionName, clientName,
    lugar: [clientName, objectiveName, positionName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ') || 'el puesto',
  }, destinos);
  await auditar('CONSULTA_DISPONIBILIDAD_CREADA', auth.uid, empresaId, `${elegibles.length} consultados · ${lugares} lugar/es · ${texto}`, { consultaId: ref.id, huecoKey, status: entrega.status });
  return { ok: true, consultaId: ref.id, lugares, consultados: elegibles.length, omitidos, resumen: entrega.resumen, status: entrega.status, venceAtMs };
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

async function mailDeInvitacion(inv: admin.firestore.DocumentData): Promise<string> {
  const cuil = String(inv.bolsaCuil || '').replace(/\D/g, '');
  if (cuil.length === 11) {
    const bolsa = await db().collection('eventuales_bolsa').doc(cuil).get();
    const mail = String(bolsa.data()?.mail || bolsa.data()?.email || '').trim();
    if (mail) return mail;
  }
  const employeeId = String(inv.employeeId || '').trim();
  if (!employeeId) return '';
  const emp = await db().collection('empleados').doc(employeeId).get();
  return String(emp.data()?.email || emp.data()?.mail || '').trim();
}

/**
 * Único cierre de invitaciones. ASIGNADO y NO quedan.
 * El resto (PENDIENTE, AVISO_MAIL, NO_LLEGO, RESERVADO) pasa al estado final.
 * VENCIDA no avisa. Quien no recibió el aviso (NO_LLEGO) tampoco.
 */
export async function cerrarInvitacionesConsulta(consultaId: string, statusPadre: string): Promise<number> {
  const reglas = await lib();
  const plan = reglas.cierreDeConsulta(statusPadre);
  if (!plan || !consultaId) return 0;
  const canal = await import('../eventuales-shared/consultaCanal.mjs') as {
    textoNoLlego: (nombre: string, motivo: string) => string;
  };
  const parentRef = db().collection(COL).doc(consultaId);
  const parentSnap = await parentRef.get();
  const data = parentSnap.data() || {};
  const vencePadre = Number(data.venceAtMs || data.venceAt?.toMillis?.() || 0);
  const respuestas = ((data.respuestas || []) as RespuestaVista[]).map((r) => {
    if (!reglas.invitacionHayQueCerrarla(r.estado)) return r;
    const entregaNota = r.estado === 'NO_LLEGO'
      ? (r.entregaNota || canal.textoNoLlego(r.nombre, String(r.motivo || '')))
      : (r.entregaNota || null);
    return { ...r, estado: plan.estado, motivo: plan.motivo, entregaNota };
  });
  if (parentSnap.exists) {
    await parentRef.update({ respuestas, resumen: reglas.textoEstadoConsulta(respuestas) });
  }
  const invs = await db().collection(INV).where('consultaId', '==', consultaId).get();
  let n = 0;
  for (const inv of invs.docs) {
    const d = inv.data();
    const previo = String(d.estado || '');
    if (!reglas.invitacionHayQueCerrarla(previo)) continue;
    const vence = Number(d.venceAtMs || 0) > 0 ? Number(d.venceAtMs) : vencePadre;
    const patch: Record<string, unknown> = {
      estado: plan.estado,
      motivo: plan.motivo,
      cerradaAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (vence > 0) patch.venceAtMs = vence;
    await inv.ref.update(patch);
    n += 1;
    const avisar = plan.avisar && previo !== 'NO_LLEGO';
    if (!avisar) continue;
    const uid = String(d.uid || '').trim();
    const employeeId = String(d.employeeId || '').trim();
    if (uid || employeeId) {
      await db().collection('user_notifications').add({
        ...(uid ? { uid } : {}),
        employeeId: employeeId || null,
        empresaId: data.empresaId || d.empresaId || null,
        type: plan.tipoAviso,
        target: 'employee',
        title: plan.linea || plan.motivo,
        body: plan.motivo,
        consultaId,
        invitacionId: inv.id,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (d.mailOk === true) {
      try {
        const mail = await mailDeInvitacion(d);
        if (mail) {
          await sendSystemMail({ to: mail, subject: plan.linea || plan.motivo, text: plan.motivo });
        }
      } catch (err) {
        if (!(err instanceof MailNotConfiguredError)) {
          console.warn('[consulta] el mail de cierre no salió');
        }
      }
    }
  }
  return n;
}

async function cerrarSiCompleta(consultaId: string, actorUid: string) {
  const parentRef = db().collection(COL).doc(consultaId);
  const snap = await parentRef.get();
  const data = snap.data() || {};
  if (String(data.status) !== 'ABIERTA') return;
  const respuestas = (data.respuestas || []) as RespuestaVista[];
  const asignados = respuestas.filter((r) => r.estado === 'ASIGNADO').length;
  if (asignados < Number(data.lugares || 0)) return;
  await parentRef.update({
    status: 'COMPLETA',
    tomados: asignados,
    venceAt: admin.firestore.FieldValue.delete(),
    cerradaAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await cerrarInvitacionesConsulta(consultaId, 'COMPLETA');
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
  const asEmployeeId = String(data?.asEmployeeId || '').trim();
  const asBolsaCuil = String(data?.asBolsaCuil || '').replace(/\D/g, '');
  const { isEventualPreviewSuperAdmin, puedeResponderConsulta } = await import('./eventualPreviewAuth');
  const token = context.auth.token as { role?: unknown; type?: unknown; bolsaCuil?: unknown };
  const ownSnap = await db().collection('empleados').where('uid', '==', uid).limit(10).get();
  const ownEmployeeIds = ownSnap.docs.map((d) => d.id);
  const porId = await db().collection('empleados').doc(uid).get();
  if (porId.exists && !ownEmployeeIds.includes(porId.id)) ownEmployeeIds.push(porId.id);
  const acceso = puedeResponderConsulta({
    isSuperAdmin: isEventualPreviewSuperAdmin(token.role, token.type),
    authUid: uid,
    claimBolsaCuil: String(token.bolsaCuil || ''),
    ownEmployeeIds,
    asEmployeeId: asEmployeeId || null,
    asBolsaCuil: asBolsaCuil || null,
    invUid: inv.uid ? String(inv.uid) : null,
    invBolsaCuil: inv.bolsaCuil ? String(inv.bolsaCuil) : null,
    invEmployeeId: inv.employeeId ? String(inv.employeeId) : null,
  });
  if (!acceso.ok) throw new functions.https.HttpsError('permission-denied', 'Esta consulta no es tuya.');
  const preview = acceso.preview;
  const marcaPreview = preview
    ? { preview: true, modo: 'preview', previewRespondedBy: uid, enNombreDe: String(inv.bolsaCuil || inv.employeeId || '') }
    : {};
  const detalle = (texto: string) => (preview ? `Vista previa · ${texto}` : texto);
  const extraPreview = preview ? { previewRespondedBy: uid, respondidoEnPreview: true } : {};
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
    if (!esperaRespuesta(inv.estado)) {
      const parent = await parentRef.get();
      return {
        ok: false,
        codigo: 'YA_RESPONDIO',
        motivo: reglas.mensajeRespuestaCerrada(String(inv.estado || ''), String(parent.data()?.status || ''), ''),
      };
    }
    const hora = horaAr(Date.now());
    await marcarRespuesta(consultaId, persona, { estado: 'NO', hora, motivo: null }, 'NO', { respondioAt: admin.firestore.FieldValue.serverTimestamp(), ...extraPreview });
    await evento(consultaId, 'RESPUESTA', { bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, respuesta: 'NO', hora, uid, ...marcaPreview });
    await auditar('CONSULTA_DISPONIBILIDAD_RESPUESTA', uid, String(inv.empresaId || ''), detalle(`${inv.nombre || quien} no puede.`), { consultaId, bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, ...marcaPreview });
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
    tx.update(invRef, {
      estado: 'RESERVADO',
      orden: decision.orden,
      respondioAt: admin.firestore.FieldValue.serverTimestamp(),
      ...extraPreview,
    });
    return { decision, pdata, hora };
  });

  if (!reserva.decision.ok) {
    const codigo = reserva.decision.codigo || 'CERRADA';
    return {
      ok: false,
      codigo,
      motivo: reglas.mensajeRespuestaCerrada(String(inv.estado || ''), String(reserva.pdata.status || ''), codigo),
    };
  }
  if (reserva.decision.idempotente && String(inv.estado) === 'ASIGNADO') return { ok: true, idempotente: true, codigo: 'ASIGNADO' };
  await evento(consultaId, 'RESPUESTA', { bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, respuesta: 'SI', hora: reserva.hora, orden: reserva.decision.orden, uid, ...marcaPreview });

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
    await marcarRespuesta(consultaId, persona, { estado: 'ASIGNADO', orden: reserva.decision.orden ?? null, hora: reserva.hora || null, motivo: null }, 'ASIGNADO', { turnoIds: asignado.turnoIds, employeeId: asignado.employeeId, ...extraPreview });
    await evento(consultaId, 'ASIGNADO', { bolsaCuil: esGuardia ? null : cuil, employeeId: asignado.employeeId, orden: reserva.decision.orden, turnoIds: asignado.turnoIds, ...marcaPreview });
    await auditar('CONSULTA_DISPONIBILIDAD_ASIGNADO', uid, empresa, detalle(`${asignado.nombre} tomó el lugar ${reserva.decision.orden}.`), { consultaId, bolsaCuil: esGuardia ? null : cuil, employeeId: asignado.employeeId, turnoIds: asignado.turnoIds, ...marcaPreview });
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
    await evento(consultaId, 'RESPUESTA', { bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, respuesta: 'NO_ELEGIBLE', motivo, uid, ...marcaPreview });
    await auditar('CONSULTA_DISPONIBILIDAD_NO_ELEGIBLE', uid, String(reserva.pdata.empresaId || ''), detalle(`${inv.nombre || quien}: ${motivo}. El lugar sigue libre.`), { consultaId, bolsaCuil: esGuardia ? null : cuil, employeeId: persona.employeeId, ...marcaPreview });
    return { ok: false, codigo: 'NO_ELEGIBLE', motivo };
  }
});

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
  await ref.update({
    status: 'CERRADA',
    venceAt: admin.firestore.FieldValue.delete(),
    canceladaAt: admin.firestore.FieldValue.serverTimestamp(),
    canceladaPor: auth.uid,
  });
  await cerrarInvitacionesConsulta(consultaId, 'CERRADA');
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
    await cerrarInvitacionesConsulta(doc.id, 'VENCIDA');
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
