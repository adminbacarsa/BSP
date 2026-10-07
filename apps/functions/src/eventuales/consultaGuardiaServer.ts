/**
 * Consulta de disponibilidad para guardias propios.
 * Misma colección que los eventuales. El que acepta se escribe como en la grilla
 * (FT = isFrancoTrabajado) y no genera contrato ni alta ARCA.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { aplicarEntregasConsulta, type DestinoEntrega } from './consultaCanalServer';
import { escenarioCobertura, planConvocadoArrival } from '../common/convocadoEta';
import { umbralCoberturaMin } from '../coverage/refEscDirecto';

const AR_OFFSET = '-03:00';
const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];
const COL = 'consultas_disponibilidad';
const INV = 'consultas_disponibilidad_invitaciones';
const FRANCO = new Set(['F', 'FF', 'FP']);

type JornadaIn = { fecha: string; horaInicio: string; horaFin: string; horas?: number; code?: string; name?: string; positionName?: string };
type GuardiaIn = { employeeId: string; tipo: 'FT' | 'RET' | 'LIBRE'; nombre?: string };
type AuthIn = { employeeId: string; kind: 'DESCANSO' | 'TOPE'; motivo: string; autorizadoPor?: string };

type LibGuardia = {
  evaluarGuardiaConsulta: (p: Record<string, unknown>) => { ok: boolean; codigo?: string; motivo?: string; marcas?: Record<string, unknown> };
  textoPushGuardia: (p: { dias: number; tipo: string; lugar: string }) => string;
  camposTurnoGuardia: (p: { tipo: string; code: string; nombreCubierto?: string }) => {
    code: string; isFranco: boolean; isFrancoTrabajado: boolean; coveredFromFranco: boolean; comments: string;
  };
  invitacionIdGuardia: (consultaId: string, employeeId: string) => string;
};

function db() {
  return admin.firestore();
}

async function libGuardia(): Promise<LibGuardia> {
  return import('../eventuales-shared/consultaGuardia.mjs') as Promise<LibGuardia>;
}

async function libConsulta() {
  return import('../eventuales-shared/consultaDisponibilidad.mjs') as Promise<{
    huecoKeyDe: (p: { empresaId: string; objectiveId?: string | null; positionName?: string | null; jornadas: JornadaIn[] }) => string;
    venceEnMs: (p: { ahoraMs: number; minutos: number; inicioPrimerTurnoMs: number | null }) => number;
    textoEstadoConsulta: (respuestas: { cuil: string; nombre: string; estado: string; orden: number | null; hora: string | null; motivo: string | null }[]) => string;
  }>;
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

function tsAr(fecha: string, hhmm: string): admin.firestore.Timestamp {
  const [h, m] = hhmm.split(':').map(Number);
  return admin.firestore.Timestamp.fromDate(new Date(`${fecha}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00.000${AR_OFFSET}`));
}

function hmDe(ts: admin.firestore.Timestamp | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ts.toDate());
  const h = String(parts.find((p) => p.type === 'hour')?.value || '0').padStart(2, '0');
  const m = String(parts.find((p) => p.type === 'minute')?.value || '0').padStart(2, '0');
  return `${h}:${m}`;
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

async function evento(consultaId: string, tipo: string, extra: Record<string, unknown>) {
  await db().collection(COL).doc(consultaId).collection('eventos').add({
    tipo, atMs: Date.now(), at: admin.firestore.FieldValue.serverTimestamp(), ...extra,
  });
}

async function auditar(action: string, actorUid: string, empresaId: string, details: string, extra: Record<string, unknown> = {}) {
  await db().collection('audit_logs').add({
    action, module: 'PLANNING', actorUid, actorName: actorUid, empresaId, details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(), ...extra,
  });
}

async function permisosGuardia(context: functions.https.CallableContext): Promise<{ uid: string; email: string; ft: boolean; cobertura: boolean }> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const claim = String(context.auth.token.role || '');
  if (SUPER.includes(claim)) return { uid: context.auth.uid, email: String(context.auth.token.email || context.auth.uid), ft: true, cobertura: true };
  const sys = await db().collection('system_users').doc(context.auth.uid).get();
  const roleId = String(sys.data()?.role || claim || '');
  if (SUPER.includes(roleId)) return { uid: context.auth.uid, email: String(context.auth.token.email || context.auth.uid), ft: true, cobertura: true };
  const rol = roleId ? await db().collection('roles').doc(roleId).get() : null;
  const planning = (rol?.data()?.permissions?.PLANNING || []) as string[];
  const eventuales = (rol?.data()?.permissions?.EVENTUALES || []) as string[];
  const ft = planning.includes('assign_ft');
  const cobertura = planning.includes('update') || eventuales.includes('convocar');
  if (!ft && !cobertura) throw new functions.https.HttpsError('permission-denied', 'No tenés permiso para consultar disponibilidad.');
  return { uid: context.auth.uid, email: String(context.auth.token.email || context.auth.uid), ft, cobertura };
}

function nombreDe(data: Record<string, unknown> | undefined, pedido: string): string {
  const directo = String(data?.nombre || data?.name || pedido || '').trim();
  if (directo) return directo;
  const armado = [data?.lastName, data?.firstName].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
  return armado || 'Guardia';
}

async function cronogramaPublicado(objectiveId: string, fecha: string): Promise<boolean> {
  const [y, m] = fecha.split('-').map(Number);
  const snap = await db().collection('planificacion_estados').doc(`${objectiveId}_${y}_${m}`).get();
  return !!snap.data()?.publishedAt;
}

type TurnoRow = {
  id: string;
  ref: admin.firestore.DocumentReference;
  empresaId?: string;
  scheduleDate?: string;
  code?: string;
  isFranco?: boolean;
  isFrancoTrabajado?: boolean;
  isReten?: boolean;
  startTime?: admin.firestore.Timestamp;
  endTime?: admin.firestore.Timestamp;
  hours?: number;
};

async function turnosEnVentana(employeeId: string, empresaId: string, desde: string, hasta: string): Promise<TurnoRow[]> {
  const snap = await db().collection('turnos').where('employeeId', '==', employeeId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as Omit<TurnoRow, 'id' | 'ref'>) }))
    .filter((t) => String(t.empresaId || empresaId) === empresaId)
    .filter((t) => {
      const fecha = String(t.scheduleDate || '');
      return fecha >= desde && fecha <= hasta;
    });
}

function turnoParaRegla(t: TurnoRow) {
  return {
    fecha: String(t.scheduleDate || ''),
    code: String(t.code || ''),
    isFranco: t.isFranco === true,
    isFrancoTrabajado: t.isFrancoTrabajado === true,
    isReten: t.isReten === true,
    horaInicio: hmDe(t.startTime),
    horaFin: hmDe(t.endTime),
    horas: Number(t.hours) || 0,
  };
}

async function topeMesDe(empresaId: string, employeeId: string, meses: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const mes of meses) {
    const snap = await db().collection('tope_autorizaciones').doc(`${empresaId}_${mes}`).get();
    const row = snap.data()?.guardias?.[employeeId] as { status?: string; autorizadoPor?: string; motivo?: string } | undefined;
    out[mes] = row?.status === 'ACTIVE' && !!String(row.autorizadoPor || '').trim() && !!String(row.motivo || '').trim();
  }
  return out;
}

export async function evaluarGuardiaEnServidor(p: {
  empresaId: string;
  employeeId: string;
  tipo: 'FT' | 'RET' | 'LIBRE';
  jornadas: JornadaIn[];
  autorizaciones: AuthIn[];
}): Promise<{ ok: boolean; codigo?: string; motivo?: string; marcas?: Record<string, unknown> }> {
  const reglas = await libGuardia();
  const fechas = p.jornadas.map((j) => j.fecha).sort();
  const desde = sumarDias(fechas[0], -4);
  const hasta = fechas[fechas.length - 1];
  const meses = [...new Set(fechas.map((f) => f.slice(0, 7)))];
  const mesDesde = `${meses[0]}-01`;
  const turnos = await turnosEnVentana(p.employeeId, p.empresaId, mesDesde < desde ? mesDesde : desde, hasta);
  const topeMes = await topeMesDe(p.empresaId, p.employeeId, meses);
  return reglas.evaluarGuardiaConsulta({
    tipo: p.tipo,
    dias: p.jornadas.map((j) => ({ fecha: j.fecha, code: j.code || 'M', horaInicio: j.horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0 })),
    turnos: turnos.map(turnoParaRegla),
    autorizaciones: p.autorizaciones.filter((a) => a.employeeId === p.employeeId).map((a) => ({ kind: a.kind, motivo: a.motivo })),
    topeMes,
  });
}

/** Escribe o actualiza el turno del guardia (el franco pasa a FT en el mismo doc). */
export async function asignarGuardiaDeConsulta(p: {
  empresaId: string;
  employeeId: string;
  nombre: string;
  tipo: 'FT' | 'RET' | 'LIBRE';
  jornadas: JornadaIn[];
  objectiveId: string | null;
  objectiveName: string | null;
  clientId: string | null;
  clientName: string | null;
  positionName: string | null;
  cubreEmployeeId: string | null;
  cubreNombre: string | null;
  autorizaciones: AuthIn[];
  actorName: string;
}): Promise<{ employeeId: string; turnoIds: string[]; nombre: string }> {
  const evaluado = await evaluarGuardiaEnServidor({
    empresaId: p.empresaId, employeeId: p.employeeId, tipo: p.tipo, jornadas: p.jornadas, autorizaciones: p.autorizaciones,
  });
  if (!evaluado.ok) {
    throw new functions.https.HttpsError('failed-precondition', evaluado.motivo || 'Ya no es elegible.');
  }
  const reglas = await libGuardia();
  const marcas = evaluado.marcas || {};
  const fechas = p.jornadas.map((j) => j.fecha).sort();
  const existentes = await turnosEnVentana(p.employeeId, p.empresaId, fechas[0], fechas[fechas.length - 1]);
  const batch = db().batch();
  const turnoIds: string[] = [];
  const publicado = new Map<string, boolean>();
  const umbral = p.tipo === 'RET' ? await umbralCoberturaMin(db(), p.empresaId) : 60;
  const ahoraMs = Date.now();
  for (const j of p.jornadas) {
    const campos = reglas.camposTurnoGuardia({ tipo: p.tipo, code: String(j.code || 'M'), nombreCubierto: p.cubreNombre || undefined });
    let draft = false;
    if (p.objectiveId) {
      const clave = j.fecha.slice(0, 7);
      if (!publicado.has(clave)) publicado.set(clave, await cronogramaPublicado(p.objectiveId, j.fecha));
      draft = !publicado.get(clave);
    }
    const start = tsAr(j.fecha, j.horaInicio);
    let end = tsAr(j.fecha, j.horaFin);
    if (end.toMillis() <= start.toMillis()) end = admin.firestore.Timestamp.fromMillis(end.toMillis() + 24 * 3600000);
    const delDia = existentes.filter((t) => String(t.scheduleDate) === j.fecha);
    const previo = delDia.find((t) => {
      const code = String(t.code || '').toUpperCase();
      return t.isFranco === true || FRANCO.has(code) || code === 'RET';
    }) || null;
    const ref = previo && p.tipo !== 'LIBRE' ? previo.ref : db().collection('turnos').doc();
    const payload: Record<string, unknown> = {
      empresaId: p.empresaId,
      employeeId: p.employeeId,
      employeeName: p.nombre,
      clientId: p.clientId,
      clientName: p.clientName,
      objectiveId: p.objectiveId,
      objectiveName: p.objectiveName,
      positionName: j.positionName || p.positionName || 'General',
      code: campos.code,
      type: j.name || campos.code,
      hours: Number(j.horas) || 0,
      startTime: start,
      endTime: end,
      scheduleDate: j.fecha,
      isFranco: campos.isFranco,
      isFrancoTrabajado: campos.isFrancoTrabajado,
      coveredFromFranco: campos.coveredFromFranco,
      isFrancoCompensatorio: false,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft,
      comments: campos.comments,
      coversEmployeeId: p.cubreEmployeeId,
      actorName: p.actorName,
      createdBy: 'CONSULTA_GUARDIA',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (p.tipo === 'RET') {
      const escenario = escenarioCobertura({ gapStartMs: start.toMillis(), nowMs: ahoraMs, umbralMin: umbral });
      payload.escenarioCobertura = escenario;
      if (escenario === 'ANTICIPADA') {
        payload.coberturaAnticipada = true;
      } else {
        const plan = planConvocadoArrival({
          acceptedAtMs: ahoraMs,
          gapStartMs: start.toMillis(),
          etaMinutes: 10,
          escenario: 'URGENTE',
        });
        payload.coberturaUrgente = true;
        payload.acceptedAt = admin.firestore.Timestamp.fromMillis(ahoraMs);
        payload.etaMinutes = 10;
        payload.reminderAt = admin.firestore.Timestamp.fromMillis(plan.reminderAtMs);
        payload.reminderPending = true;
        payload.delayAlertPending = true;
        payload.expectedArrivalAt = admin.firestore.Timestamp.fromMillis(plan.expectedArrivalMs);
      }
    }
    if (marcas.descansoReducido) {
      payload.descansoReducido = true;
      payload.descansoHoras = marcas.descansoHoras ?? null;
      payload.autorizacionMotivo = marcas.autorizacionMotivo || null;
    }
    if (marcas.topeExcedido) {
      payload.topeExcedido = true;
      payload.horasMes = marcas.horasMes ?? null;
      payload.autorizacionMotivo = marcas.autorizacionMotivo || null;
    }
    if (previo && p.tipo !== 'LIBRE') batch.update(ref, payload);
    else {
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      batch.set(ref, payload);
    }
    turnoIds.push(ref.id);
  }
  await batch.commit();
  return { employeeId: p.employeeId, turnoIds, nombre: p.nombre };
}

export async function crearConsultaGuardias(data: Record<string, unknown>, context: functions.https.CallableContext) {
  const permiso = await permisosGuardia(context);
  const reglas = await libGuardia();
  const consulta = await libConsulta();
  const empresaId = String(data?.empresaId || '');
  const jornadas = ((data?.jornadas || []) as Partial<JornadaIn>[]).filter(validarJornada);
  const pedidos = ((data?.guardias || []) as Partial<GuardiaIn>[])
    .map((g) => ({
      employeeId: String(g?.employeeId || '').trim(),
      tipo: String(g?.tipo || '').toUpperCase() as GuardiaIn['tipo'],
      nombre: g?.nombre ? String(g.nombre) : '',
    }))
    .filter((g) => g.employeeId && (g.tipo === 'FT' || g.tipo === 'RET' || g.tipo === 'LIBRE'));
  const unicos = [...new Map(pedidos.map((g) => [g.employeeId, g])).values()];
  if (!empresaId || !jornadas.length) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o jornadas.');
  if (!unicos.length) throw new functions.https.HttpsError('invalid-argument', 'Elegí al menos un guardia.');
  if (unicos.length > 30) throw new functions.https.HttpsError('invalid-argument', 'Máximo 30 guardias por consulta.');
  const jornadasNorm: JornadaIn[] = jornadas.map((j) => ({
    fecha: j.fecha,
    horaInicio: j.horaInicio,
    horaFin: j.horaFin,
    horas: Number(j.horas) || 0,
    code: String(j.code || 'M').toUpperCase(),
    ...(j.name ? { name: j.name } : {}),
    ...(j.positionName || data?.positionName ? { positionName: String(j.positionName || data.positionName) } : {}),
  }));
  const autorizaciones = ((data?.autorizaciones || []) as Partial<AuthIn>[])
    .map((a) => ({
      employeeId: String(a?.employeeId || '').trim(),
      kind: String(a?.kind || '').toUpperCase() as AuthIn['kind'],
      motivo: String(a?.motivo || '').trim(),
      autorizadoPor: a?.autorizadoPor ? String(a.autorizadoPor) : permiso.email,
    }))
    .filter((a) => a.employeeId && a.motivo && (a.kind === 'DESCANSO' || a.kind === 'TOPE'));

  const clientId = data?.clientId ? String(data.clientId) : null;
  const objectiveId = data?.objectiveId ? String(data.objectiveId) : null;
  const clientName = data?.clientName ? String(data.clientName) : null;
  const objectiveName = data?.objectiveName ? String(data.objectiveName) : null;
  const positionName = data?.positionName ? String(data.positionName) : null;
  const lugar = [clientName, objectiveName, positionName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');

  const elegibles: { employeeId: string; tipo: GuardiaIn['tipo']; nombre: string; uid: string; mail: string; pushEstado: string }[] = [];
  const omitidos: { employeeId: string; motivo: string }[] = [];
  for (const g of unicos) {
    if (g.tipo === 'FT' && !permiso.ft) {
      omitidos.push({ employeeId: g.employeeId, motivo: 'Sin permiso para franco trabajado.' });
      continue;
    }
    if (g.tipo !== 'FT' && !permiso.cobertura) {
      omitidos.push({ employeeId: g.employeeId, motivo: 'Sin permiso para consultar esta cobertura.' });
      continue;
    }
    const emp = await db().collection('empleados').doc(g.employeeId).get();
    const ed = emp.data() as Record<string, unknown> | undefined;
    if (!emp.exists || String(ed?.status || 'ACTIVE') === 'INACTIVE') {
      omitidos.push({ employeeId: g.employeeId, motivo: 'El guardia no está activo.' });
      continue;
    }
    if (ed?.empresaId && String(ed.empresaId) !== empresaId) {
      omitidos.push({ employeeId: g.employeeId, motivo: 'No es de esta empresa.' });
      continue;
    }
    const uid = String(ed?.uid || '');
    const mail = String(ed?.email || ed?.mail || '');
    const pushEstado = String(ed?.pushEstado || '');
    const ev = await evaluarGuardiaEnServidor({
      empresaId, employeeId: g.employeeId, tipo: g.tipo, jornadas: jornadasNorm,
      autorizaciones: autorizaciones.filter((a) => a.employeeId === g.employeeId),
    });
    if (!ev.ok) omitidos.push({ employeeId: g.employeeId, motivo: ev.motivo || 'No se puede consultar.' });
    else elegibles.push({ employeeId: g.employeeId, tipo: g.tipo, nombre: nombreDe(ed, g.nombre), uid, mail, pushEstado });
  }
  if (!elegibles.length) throw new functions.https.HttpsError('failed-precondition', omitidos[0]?.motivo || 'Nadie quedó para consultar.');

  const lugares = Math.max(1, Math.min(Number(data?.lugares) || 1, elegibles.length, 20));
  const huecoKey = consulta.huecoKeyDe({ empresaId, objectiveId, positionName, jornadas: jornadasNorm });
  const ahora = Date.now();
  const venceAtMs = consulta.venceEnMs({ ahoraMs: ahora, minutos: Number(data?.venceMinutos), inicioPrimerTurnoMs: inicioMs(jornadasNorm) });
  const respuestas = elegibles.map((e) => ({
    cuil: '', employeeId: e.employeeId, tipo: 'GUARDIA', nombre: e.nombre, estado: 'PENDIENTE', orden: null, hora: null, motivo: null,
  }));
  const ref = db().collection(COL).doc();
  const batch = db().batch();
  batch.set(ref, {
    empresaId, huecoKey, status: 'ABIERTA', lugares, tomados: 0, audiencia: 'GUARDIA',
    jornadas: jornadasNorm,
    guardias: elegibles.map((e) => ({ employeeId: e.employeeId, tipo: e.tipo })),
    autorizaciones: autorizaciones.filter((a) => elegibles.some((e) => e.employeeId === a.employeeId)),
    clientId, clientName, objectiveId, objectiveName, positionName,
    cubreEmployeeId: data?.cubreEmployeeId ? String(data.cubreEmployeeId) : null,
    cubreNombre: data?.cubreNombre ? String(data.cubreNombre) : null,
    venceAt: admin.firestore.Timestamp.fromMillis(venceAtMs), venceAtMs,
    creadoPor: permiso.uid, creadoPorNombre: permiso.email,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    respuestas, resumen: consulta.textoEstadoConsulta(respuestas),
  });
  for (const e of elegibles) {
    const texto = reglas.textoPushGuardia({ dias: jornadasNorm.length, tipo: e.tipo, lugar });
    batch.set(db().collection(INV).doc(reglas.invitacionIdGuardia(ref.id, e.employeeId)), {
      consultaId: ref.id, empresaId, tipo: 'GUARDIA', employeeId: e.employeeId, uid: e.uid,
      cobertura: e.tipo, nombre: e.nombre, estado: 'PENDIENTE', texto, jornadas: jornadasNorm,
      clientName, objectiveName, positionName, venceAtMs, huecoKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  await evento(ref.id, 'CREADA', { actorUid: permiso.uid, lugares, employeeIds: elegibles.map((e) => e.employeeId), venceAtMs, audiencia: 'GUARDIA' });
  const destinos: DestinoEntrega[] = elegibles.map((e) => ({
    invitacionId: reglas.invitacionIdGuardia(ref.id, e.employeeId),
    nombre: e.nombre,
    uid: e.uid,
    mail: e.mail,
    pushEstado: e.pushEstado,
    employeeId: e.employeeId,
    bolsaCuil: null,
    texto: reglas.textoPushGuardia({ dias: jornadasNorm.length, tipo: e.tipo, lugar }),
    cuil: '',
    tipo: 'GUARDIA',
  }));
  const entrega = await aplicarEntregasConsulta({
    consultaId: ref.id, empresaId, actorUid: permiso.uid,
    objectiveId, objectiveName, positionName, clientName, lugar,
  }, destinos);
  await auditar('CONSULTA_DISPONIBILIDAD_CREADA', permiso.uid, empresaId, `${elegibles.length} guardias consultados · ${lugares} lugar/es`, { consultaId: ref.id, huecoKey, audiencia: 'GUARDIA', status: entrega.status });
  return { ok: true, consultaId: ref.id, lugares, consultados: elegibles.length, omitidos, resumen: entrega.resumen, status: entrega.status, venceAtMs };
}
