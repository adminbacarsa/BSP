import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { buildOpsCoverageDocId } from './syncAusenciaCobertura';
import { logConvocatoriaEvento } from './convocatoriaEventos';
import {
  CONVOCADO_ETA_SPEED_KMH,
  CONVOCADO_ETA_WAIT_MIN,
  convocadoReminderAtMs,
  convocadoTravelEta,
  haversineKm,
} from '../common/convocadoEta';

export type OriginCoords = { lat?: number; lng?: number; accuracy?: number };

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pair(obj: Record<string, unknown> | undefined, latKeys: string[], lngKeys: string[]): { lat: number; lng: number } | null {
  if (!obj) return null;
  let lat: number | null = null;
  let lng: number | null = null;
  for (const k of latKeys) {
    const n = num(obj[k]);
    if (n != null) { lat = n; break; }
  }
  for (const k of lngKeys) {
    const n = num(obj[k]);
    if (n != null) { lng = n; break; }
  }
  const nested = obj.domicilio as Record<string, unknown> | undefined;
  if (lat == null) lat = num(nested?.lat ?? nested?.latitude);
  if (lng == null) lng = num(nested?.lng ?? nested?.longitude);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

async function empresaEtaParams(db: Firestore, empresaId: string): Promise<{ speed: number; wait: number }> {
  const snap = empresaId ? await db.collection('empresas').doc(empresaId).get() : null;
  const d = snap?.data() || {};
  const speed = num(d.convocadoEtaSpeedKmh) ?? CONVOCADO_ETA_SPEED_KMH;
  const wait = num(d.convocadoEtaWaitMinutes) ?? CONVOCADO_ETA_WAIT_MIN;
  return { speed, wait };
}

/**
 * Al aceptar: origen (celular o domicilio), ETA y hora estimada de llegada.
 * ESC/REF en el mismo objetivo no viajan (5 min).
 */
export async function recordConvocadoAcceptEta(
  db: Firestore,
  convocatoriaId: string,
  opts: { originCoords?: OriginCoords | null; now?: Timestamp } = {},
): Promise<{ etaMinutes: number; originSource: 'DEVICE' | 'DOMICILIO' | 'SIN_COORD' }> {
  const id = String(convocatoriaId || '').trim();
  const ref = db.collection('convocatorias_cobertura').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { etaMinutes: CONVOCADO_ETA_WAIT_MIN, originSource: 'SIN_COORD' };
  const conv = snap.data() as Record<string, unknown>;
  const now = opts.now || Timestamp.now();
  const nowMs = now.toMillis();

  const empId = String(conv.candidateEmployeeId || '').trim();
  const emp = empId ? (await db.collection('empleados').doc(empId).get()).data() as Record<string, unknown> | undefined : undefined;
  const titId = String(conv.shiftId || '').trim();
  const tit = titId ? (await db.collection('turnos').doc(titId).get()).data() as Record<string, unknown> | undefined : undefined;

  const device = pair(opts.originCoords as Record<string, unknown> | undefined, ['lat', 'latitude'], ['lng', 'longitude', 'lon']);
  const home = pair(emp, ['lat', 'latitude'], ['lng', 'longitude', 'lon']);
  const origin = device || home;
  const originSource: 'DEVICE' | 'DOMICILIO' | 'SIN_COORD' = device ? 'DEVICE' : home ? 'DOMICILIO' : 'SIN_COORD';

  const dest = pair(tit, ['lat', 'objectiveLat', 'latitude'], ['lng', 'objectiveLng', 'longitude']);
  const km = origin && dest ? haversineKm(origin.lat, origin.lng, dest.lat, dest.lng) : null;

  let sameObjective = false;
  const ct = String(conv.type || '').toUpperCase();
  const sourceId = String(conv.candidateShiftId || conv.extendShiftId || conv.advanceShiftId || conv.ftShiftId || '').trim();
  if ((ct === 'ESC' || ct === 'REF') && sourceId) {
    const src = (await db.collection('turnos').doc(sourceId).get()).data();
    sameObjective = !!src && String(src.objectiveId || '') === String(conv.objectiveId || '') && !!conv.objectiveId;
  }

  const params = await empresaEtaParams(db, String(conv.empresaId || ''));
  const travel = convocadoTravelEta({
    coverageType: ct,
    sameObjective,
    distanceKm: km,
    speedKmh: params.speed,
    waitMin: params.wait,
  });
  const etaMinutes = travel.etaMinutes;
  const expectedMs = nowMs + etaMinutes * 60 * 1000;
  const reminderMs = convocadoReminderAtMs(nowMs, etaMinutes);

  const patch = {
    originCoords: origin ? { lat: origin.lat, lng: origin.lng, ...(num(opts.originCoords?.accuracy) != null ? { accuracy: num(opts.originCoords?.accuracy) } : {}) } : null,
    originSource,
    etaMinutes,
    etaTraveled: travel.traveled,
    expectedArrivalAt: Timestamp.fromMillis(expectedMs),
    reminderAt: Timestamp.fromMillis(reminderMs),
    acceptedAt: conv.respondedAt || now,
  };
  await ref.update(patch);

  const covId = buildOpsCoverageDocId(titId, empId);
  const cov = await db.collection('turnos').doc(covId).get();
  if (cov.exists) {
    await cov.ref.update({
      expectedArrivalAt: patch.expectedArrivalAt,
      originSource,
      etaMinutes,
      convocadoReminderAt: patch.reminderAt,
      acceptedAt: patch.acceptedAt,
    });
  }

  await logConvocatoriaEvento(db, id, {
    type: 'ACEPTADA',
    originSource,
    etaMinutes,
    at: now,
  });
  return { etaMinutes, originSource };
}

export async function responderRecordatorioConvocadoShift(
  db: Firestore,
  input: {
    convocatoriaId: string;
    action: 'ON_WAY' | 'PROBLEM';
    etaMinutes?: number;
    note?: string;
    operatorUid?: string;
  },
): Promise<{ success: boolean; reason?: string }> {
  const id = String(input.convocatoriaId || '').trim();
  if (!id) return { success: false, reason: 'INVALID' };
  const ref = db.collection('convocatorias_cobertura').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { success: false, reason: 'NOT_FOUND' };
  const conv = snap.data() as Record<string, unknown>;
  if (String(conv.status || '') !== 'ACCEPTED') return { success: false, reason: 'NOT_ACCEPTED' };

  const now = Timestamp.now();
  if (input.action === 'PROBLEM') {
    const note = String(input.note || '').trim();
    await db.collection('novedades').add({
      type: 'PROBLEMA_CONVOCADO',
      status: 'pending',
      priority: 'high',
      convocatoriaId: id,
      shiftId: conv.shiftId || null,
      employeeId: conv.candidateEmployeeId || null,
      employeeName: conv.candidateEmployeeName || '',
      objectiveId: conv.objectiveId || null,
      objectiveName: conv.objectiveName || '',
      empresaId: conv.empresaId || null,
      title: 'Problema del convocado',
      description: note || `${conv.candidateEmployeeName || 'Convocado'} avisó un problema yendo al objetivo.`,
      createdAt: FieldValue.serverTimestamp(),
      source: 'CONVOCADO',
    });
    await ref.update({ convocadoReply: 'PROBLEM', convocadoReplyAt: now, convocadoReplyNote: note || null });
    await logConvocatoriaEvento(db, id, { type: 'RESPUESTA', response: 'PROBLEM', reason: note || undefined, at: now });
    return { success: true };
  }

  const eta = [10, 15, 30].includes(Number(input.etaMinutes)) ? Number(input.etaMinutes) : 15;
  const expected = Timestamp.fromMillis(now.toMillis() + eta * 60 * 1000);
  await ref.update({
    convocadoReply: 'ON_WAY',
    convocadoReplyAt: now,
    convocadoReplyEtaMinutes: eta,
    expectedArrivalAt: expected,
    delayAlertedForArrivalAt: FieldValue.delete(),
  });
  const covId = buildOpsCoverageDocId(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
  const cov = await db.collection('turnos').doc(covId).get();
  if (cov.exists) {
    await cov.ref.update({
      expectedArrivalAt: expected,
      convocadoReply: 'ON_WAY',
      convocadoDemorado: false,
    });
  }
  await logConvocatoriaEvento(db, id, { type: 'RESPUESTA', response: 'ON_WAY', etaMinutes: eta, at: now });
  return { success: true };
}
