/**
 * REF/ESC en el mismo objetivo y horario del hueco: asignación directa.
 * No crea convocatoria ni pregunta de asistencia. El aviso es informativo.
 */
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { guardFirstName } from '../common/pushGreeting';
import {
  convocadoTravelEta,
  escenarioCobertura,
  haversineKm,
  planConvocadoArrival,
  retenerSalientePorLlegada,
  UMBRAL_COBERTURA_ANTICIPADA_MIN,
  type EscenarioCobertura,
} from '../common/convocadoEta';
import { retainOutgoingForGap } from './coverageRetention';
import {
  gapWindowFromConvocatoria,
  sourceShiftEligibleForCoverageGap,
} from './coverageSourceShiftForGap';
import {
  applyCoverage,
  buildOpsCoverageDocId,
  CoverageApplyError,
  syncAusenciaCoberturaGestionada,
} from './syncAusenciaCobertura';

const NOMBRE_TURNO: Record<string, string> = {
  M: 'Turno Mañana',
  T: 'Turno Tarde',
  N: 'Turno Noche',
  D12: 'Diurno 12h',
  N12: 'Nocturno 12h',
};

/** T−5: antes de esto no hay pregunta de asistencia (¿Venís? / ¿Seguís en camino?). */
export const ASISTENCIA_LEAD_MS = 5 * 60 * 1000;
/** Fichada del convocado con el hueco todavía lejos: abre a T−15. */
export const FICHADA_LEAD_MS = 15 * 60 * 1000;

export function esRefOEsc(type: unknown): boolean {
  const t = String(type || '').trim().toUpperCase();
  return t === 'REF' || t === 'ESC';
}

export function esRet(type: unknown): boolean {
  return String(type || '').trim().toUpperCase() === 'RET';
}

export function textoTurnoActualizado(input: {
  code?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
}): string {
  const code = String(input.code || '').trim().toUpperCase() || 'M';
  const nombre = NOMBRE_TURNO[code] || `Turno ${code}`;
  const lugar = [input.objectiveName, input.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  return `Tu turno fue actualizado a ${nombre} (${code})${lugar ? ` en ${lugar}` : ''}.`;
}

/**
 * Mismo objetivo y el turno origen solapa el hueco (banda u horario).
 * RET no entra acá: se asigna directo en cualquier objetivo (`asignarRetDirecto`).
 */
export function refEscMismoObjetivo(input: {
  type: unknown;
  source: Record<string, unknown> | null | undefined;
  objectiveId: unknown;
  startTime?: Timestamp | null;
  endTime?: Timestamp | null;
  shiftCode?: string | null;
}): boolean {
  if (!esRefOEsc(input.type) || !input.source) return false;
  const gapObj = String(input.objectiveId || '').trim();
  const srcObj = String(input.source.objectiveId || '').trim();
  if (!gapObj || gapObj !== srcObj) return false;
  const gap = gapWindowFromConvocatoria({
    startTime: input.startTime || undefined,
    endTime: input.endTime || undefined,
    shiftCode: String(input.shiftCode || ''),
  });
  if (!gap) return false;
  return sourceShiftEligibleForCoverageGap(input.source, gap);
}

/** El hueco empieza más adelante que la ventana de asistencia (T−5). */
export function asistenciaAntesDeVentana(gapStartMs: number, nowMs: number): boolean {
  return gapStartMs > 0 && nowMs > 0 && gapStartMs - nowMs > ASISTENCIA_LEAD_MS;
}

/**
 * Fichada: si faltan más de 15 min, abre a T−15. Si el hueco ya empezó o está cerca, desde la aceptación.
 */
export function fichadaAbreMs(gapStartMs: number, acceptedMs: number): number {
  if (gapStartMs > 0 && acceptedMs > 0 && gapStartMs - acceptedMs > FICHADA_LEAD_MS) {
    return gapStartMs - FICHADA_LEAD_MS;
  }
  return acceptedMs;
}

type DirectaInput = {
  empresaId: string;
  shiftId: string;
  objectiveId: string;
  objectiveName?: string;
  positionName?: string;
  clientId?: string;
  clientName?: string;
  shiftCode?: string;
  startTime: Timestamp;
  endTime: Timestamp;
  type: string;
  candidateEmployeeId: string;
  candidateEmployeeName: string;
  candidateShiftId?: string;
  createdBy: string;
};

function resolvedByDe(createdBy: string): 'OPERACIONES' | 'AUTO' | 'MODO_DEMO' {
  const c = String(createdBy || '').toUpperCase();
  if (c === 'MODO_DEMO') return 'MODO_DEMO';
  if (c === 'AUTO') return 'AUTO';
  return 'OPERACIONES';
}

/** Hora Argentina HH:MM (24 h). */
export function horaArHm(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * RET directo. Hueco futuro: «Presentate a las HH:MM.» Si ya empezó: «lo antes posible».
 */
export function textoAsignacionRet(input: {
  nombre?: string | null;
  clientName?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
  code?: string | null;
  desde: string;
  hasta: string;
  huecoFuturo: boolean;
  horaLlegada?: string | null;
}): string {
  const code = String(input.code || '').trim().toUpperCase() || 'M';
  const lugar = [input.clientName, input.objectiveName, input.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  const banda = `${code} ${input.desde}–${input.hasta}`;
  const cuando = input.huecoFuturo && input.horaLlegada
    ? `Presentate a las ${input.horaLlegada}.`
    : 'Presentate lo antes posible.';
  const cuerpo = `se te asignó cubrir ${lugar}${lugar ? ', ' : ''}${banda}. ${cuando}`;
  const nombre = String(input.nombre || '').trim();
  if (!nombre) return cuerpo.charAt(0).toLocaleUpperCase('es-AR') + cuerpo.slice(1);
  return `${nombre}, ${cuerpo}`;
}

function numCoord(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parCoords(obj: Record<string, unknown> | undefined): { lat: number; lng: number } | null {
  if (!obj) return null;
  const nested = obj.domicilio as Record<string, unknown> | undefined;
  const lat = numCoord(obj.lat ?? obj.latitude ?? nested?.lat ?? nested?.latitude);
  const lng = numCoord(obj.lng ?? obj.longitude ?? obj.lon ?? nested?.lng ?? nested?.longitude);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

async function avisarEmpleado(
  db: admin.firestore.Firestore,
  employeeId: string,
  title: string,
  body: string,
  type: string,
  turnoId: string,
  empresaId: string,
): Promise<void> {
  const emp = await db.collection('empleados').doc(employeeId).get();
  const uid = emp.exists ? String(emp.data()?.uid || '') : '';
  await db.collection('user_notifications').add({
    uid: uid || null,
    employeeId,
    title,
    body,
    type,
    target: 'employee',
    turnoId,
    empresaId: empresaId || null,
    read: false,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (!uid && !employeeId) return;
  const [byEmp, byUid] = await Promise.all([
    db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
    uid ? db.collection('device_tokens').where('uid', '==', uid).get() : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
  ]);
  const tokens = new Set<string>();
  for (const d of [...byEmp.docs, ...byUid.docs]) {
    const t = d.data()?.token;
    if (typeof t === 'string' && t.length > 10) tokens.add(t);
  }
  if (!tokens.size) return;
  try {
    await admin.messaging().sendEachForMulticast({
      tokens: [...tokens],
      notification: { title, body },
      data: { type, turnoId },
    });
  } catch {
    /* sin FCM (emulador o sin token válido) el aviso queda en la bandeja */
  }
}

function diaAviso(gapMs: number, nowMs: number): string {
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  const g = day(gapMs);
  if (g === day(nowMs)) return 'hoy';
  if (g === day(nowMs + 24 * 60 * 60 * 1000)) return 'mañana';
  const [y, m, d] = g.split('-');
  void y;
  return `el ${d}/${m}`;
}

/** RET anticipada: «hoy/mañana a las HH:MM cubrís …». */
export function textoRetAnticipado(input: {
  nombre?: string | null;
  cuando: string;
  hora: string;
  clientName?: string | null;
  objectiveName?: string | null;
  positionName?: string | null;
  code?: string | null;
  desde: string;
  hasta: string;
}): string {
  const code = String(input.code || '').trim().toUpperCase() || 'M';
  const lugar = [input.clientName, input.objectiveName, input.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  const banda = `${code} ${input.desde}–${input.hasta}`;
  const cuerpo = `${input.cuando} a las ${input.hora} cubrís ${lugar}${lugar ? ', ' : ''}${banda}.`;
  const nombre = String(input.nombre || '').trim();
  if (!nombre) return cuerpo.charAt(0).toLocaleUpperCase('es-AR') + cuerpo.slice(1);
  return `${nombre}, ${cuerpo}`;
}

export async function umbralCoberturaMin(db: admin.firestore.Firestore, empresaId: string): Promise<number> {
  if (!empresaId) return UMBRAL_COBERTURA_ANTICIPADA_MIN;
  const snap = await db.collection('empresas').doc(empresaId).get();
  const n = Number(snap.data()?.coberturaAnticipadaMin);
  return Number.isFinite(n) && n >= 0 ? n : UMBRAL_COBERTURA_ANTICIPADA_MIN;
}

/**
 * REF/ESC/RET. Anticipada: turno planificado, sin convocatoria.
 * Urgente en el mismo objetivo (y todo RET): convocado directo.
 * Urgente de REF/ESC en otro objetivo: null (hay que pedir aceptación).
 */
export async function resolverCoberturaRefEscRet(
  db: admin.firestore.Firestore,
  data: DirectaInput,
  opts?: { now?: Timestamp },
): Promise<string | null> {
  if (!esRefOEsc(data.type) && !esRet(data.type)) return null;
  if (!data.shiftId || !data.candidateEmployeeId || !data.startTime) return null;
  const now = opts?.now || Timestamp.now();
  const nowMs = now.toMillis();
  const umbral = await umbralCoberturaMin(db, data.empresaId);
  const gapStartMs = data.startTime.toMillis();
  const escenario: EscenarioCobertura = escenarioCobertura({ gapStartMs, nowMs, umbralMin: umbral });
  const mismo = esRet(data.type) || refEscMismoObjetivo({
    type: data.type,
    source: data.candidateShiftId
      ? (await db.collection('turnos').doc(data.candidateShiftId).get()).data() as Record<string, unknown> | undefined
      : null,
    objectiveId: data.objectiveId,
    startTime: data.startTime,
    endTime: data.endTime,
    shiftCode: data.shiftCode,
  });
  if (esRefOEsc(data.type) && !mismo && escenario === 'URGENTE') return null;

  const sourceId = String(data.candidateShiftId || '').trim();
  const resolvedBy = resolvedByDe(data.createdBy);
  const anticipada = escenario === 'ANTICIPADA';
  const convRef = anticipada ? null : db.collection('convocatorias_cobertura').doc();
  const batch = db.batch();
  let covDocId = '';
  try {
    covDocId = await applyCoverage(db, batch, {
      titularShiftId: data.shiftId,
      candidateEmployeeId: data.candidateEmployeeId,
      candidateEmployeeName: data.candidateEmployeeName,
      ...(sourceId ? { sourceShiftId: sourceId } : {}),
      coverageType: String(data.type).toUpperCase(),
      resolvedBy,
      empresaId: data.empresaId,
      startTime: data.startTime,
      endTime: data.endTime,
      code: data.shiftCode,
      objectiveId: data.objectiveId,
      objectiveName: data.objectiveName,
      positionName: data.positionName,
      clientId: data.clientId,
      clientName: data.clientName,
      titularCloseMode: 'FULL',
      acceptedAt: now,
      coberturaAnticipada: anticipada,
      coberturaUrgente: !anticipada,
      escenarioCobertura: escenario,
      retAsignacionDirecta: !anticipada && esRet(data.type),
      ...(convRef ? { convocatoriaId: convRef.id } : {}),
    });
    await syncAusenciaCoberturaGestionada(db, {
      shiftId: data.shiftId,
      coveredByEmployeeId: data.candidateEmployeeId,
      coveredByEmployeeName: data.candidateEmployeeName,
      coverageType: String(data.type).toUpperCase(),
      resolvedBy,
      empresaId: data.empresaId,
    }, batch);
  } catch (e) {
    if (e instanceof CoverageApplyError && e.code === 'ALREADY_COVERED') {
      return buildOpsCoverageDocId(data.shiftId, data.candidateEmployeeId);
    }
    throw e;
  }
  await batch.commit();

  const empSnap = await db.collection('empleados').doc(data.candidateEmployeeId).get();
  const emp = empSnap.exists ? empSnap.data() as Record<string, unknown> : undefined;
  const nombre = guardFirstName({ firstName: emp?.firstName, employeeName: data.candidateEmployeeName });
  const desde = horaArHm(gapStartMs);
  const hasta = horaArHm(data.endTime?.toMillis?.() ?? 0);

  if (anticipada) {
    const texto = esRet(data.type)
      ? textoRetAnticipado({
        nombre,
        cuando: diaAviso(gapStartMs, nowMs),
        hora: desde,
        clientName: data.clientName,
        objectiveName: data.objectiveName,
        positionName: data.positionName,
        code: data.shiftCode,
        desde,
        hasta,
      })
      : textoTurnoActualizado({
        code: data.shiftCode,
        objectiveName: data.objectiveName,
        positionName: data.positionName,
      });
    await avisarEmpleado(
      db, data.candidateEmployeeId,
      esRet(data.type) ? 'Turno asignado' : 'Turno actualizado',
      texto,
      esRet(data.type) ? 'TURNO_ASIGNADO' : 'TURNO_ACTUALIZADO',
      covDocId, data.empresaId,
    ).catch((err) => console.warn('[cobertura anticipada] aviso:', (err as Error).message));
    return covDocId;
  }

  const tit = (await db.collection('turnos').doc(data.shiftId).get()).data() as Record<string, unknown> | undefined;
  const home = parCoords(emp);
  const dest = parCoords(tit);
  const km = home && dest ? haversineKm(home.lat, home.lng, dest.lat, dest.lng) : null;
  const travel = convocadoTravelEta({
    coverageType: String(data.type).toUpperCase(),
    sameObjective: esRefOEsc(data.type) && mismo,
    distanceKm: km,
  });
  const gapEndMs = data.endTime?.toMillis?.() ?? 0;
  const plan = planConvocadoArrival({
    acceptedAtMs: nowMs,
    gapStartMs,
    etaMinutes: travel.etaMinutes,
    escenario: 'URGENTE',
  });
  await db.collection('turnos').doc(covDocId).set({
    acceptedAt: now,
    originCoords: home ? { lat: home.lat, lng: home.lng } : null,
    originSource: home ? 'DOMICILIO' : 'SIN_COORD',
    etaMinutes: travel.etaMinutes,
    expectedArrivalAt: Timestamp.fromMillis(plan.expectedArrivalMs),
    convocadoReminderAt: Timestamp.fromMillis(plan.reminderAtMs),
    coberturaUrgente: true,
    escenarioCobertura: 'URGENTE',
  }, { merge: true });
  await convRef.set({
    empresaId: data.empresaId,
    shiftId: data.shiftId,
    objectiveId: data.objectiveId,
    objectiveName: data.objectiveName || '',
    positionName: data.positionName || '',
    clientId: data.clientId || '',
    clientName: data.clientName || '',
    shiftCode: data.shiftCode || '',
    startTime: data.startTime,
    endTime: data.endTime,
    type: String(data.type).toUpperCase(),
    urgency: 'URGENTE',
    cascadeStep: 0,
    candidateEmployeeId: data.candidateEmployeeId,
    candidateEmployeeName: data.candidateEmployeeName,
    ...(sourceId ? { candidateShiftId: sourceId } : {}),
    status: 'ACCEPTED',
    asignacionDirecta: true,
    timeoutAt: now,
    createdAt: now,
    createdBy: data.createdBy || 'AUTO',
    respondedAt: now,
    acceptedAt: now,
    originSource: home ? 'DOMICILIO' : 'SIN_COORD',
    etaMinutes: travel.etaMinutes,
    expectedArrivalAt: Timestamp.fromMillis(plan.expectedArrivalMs),
    reminderAt: Timestamp.fromMillis(plan.reminderAtMs),
    reminderPending: true,
    delayAlertPending: true,
    escenarioCobertura: 'URGENTE',
    ...(gapStartMs > 0 ? { gapStartAt: Timestamp.fromMillis(gapStartMs) } : {}),
    ...(gapEndMs > 0 ? { gapEndAt: Timestamp.fromMillis(gapEndMs) } : {}),
  });
  const texto = textoAsignacionRet({
    nombre,
    clientName: data.clientName,
    objectiveName: data.objectiveName,
    positionName: data.positionName,
    code: data.shiftCode,
    desde,
    hasta,
    huecoFuturo: false,
  });
  await avisarEmpleado(
    db, data.candidateEmployeeId, 'Turno asignado', texto, 'TURNO_ASIGNADO', covDocId, data.empresaId,
  ).catch((err) => console.warn('[cobertura urgente] aviso:', (err as Error).message));

  if (retenerSalientePorLlegada({ gapStartMs, nowMs, etaMinutes: travel.etaMinutes }) && tit) {
    await retainOutgoingForGap(db, { ...tit, id: data.shiftId }, {
      nowMs,
      holdNow: gapStartMs > nowMs,
      sendPush: true,
    }).catch((err) => console.warn('[cobertura urgente] retención:', (err as Error).message));
  }
  return covDocId;
}

export async function asignarRefEscSiMismoObjetivo(
  db: admin.firestore.Firestore,
  data: DirectaInput,
): Promise<string | null> {
  if (!esRefOEsc(data.type)) return null;
  return resolverCoberturaRefEscRet(db, data);
}

export async function asignarRetDirecto(
  db: admin.firestore.Firestore,
  data: DirectaInput,
  opts?: { now?: Timestamp },
): Promise<string | null> {
  if (!esRet(data.type)) return null;
  return resolverCoberturaRefEscRet(db, data, opts);
}
