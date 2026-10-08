import { formatTimeAr, toDate } from '../utils/dates';
import { isCoverageHoursOnSourceDoc, timestampLikeToMillis } from './evaluateCheckInWindow';

export const CONVOCADO_ETA_OPTIONS = [10, 15, 30] as const;
export type ConvocadoEtaMinutes = (typeof CONVOCADO_ETA_OPTIONS)[number];

/**
 * Campos que escribe el servidor (convocadoAcceptEta / convocadoFollowUp) en
 * convocatorias_cobertura. El turno ops_cov replica expectedArrivalAt,
 * convocadoReminderSentAt, convocadoReply y convocadoDemorado.
 */
export type RecordatorioConvocadoLike = {
  id?: string;
  status?: string;
  type?: string;
  shiftId?: string;
  objectiveName?: string;
  /** ETA en minutos calculado al aceptar (o el elegido en ON_WAY). */
  etaMinutes?: number;
  /** Hora estimada de llegada. */
  expectedArrivalAt?: unknown;
  /** Cuándo toca el recordatorio y cuándo se envió. */
  reminderAt?: unknown;
  reminderSentAt?: unknown;
  /** Inicio del hueco. Fuera de REF/ESC/RET, si falta más de 5 min la tarjeta no pregunta. */
  gapStartAt?: unknown;
  startTime?: unknown;
  escenarioCobertura?: 'ANTICIPADA' | 'URGENTE' | string;
  coberturaAnticipada?: boolean;
  /** Respuesta del convocado al recordatorio. */
  convocadoReply?: 'ON_WAY' | 'PROBLEM' | string;
  convocadoReplyAt?: unknown;
  convocadoReplyNote?: string | null;
  convocadoReplyEtaMinutes?: number;
  convocadoDemorado?: boolean;
  originCoords?: { lat: number; lng: number; accuracy?: number } | null;
  originSource?: 'DEVICE' | 'DOMICILIO' | 'SIN_COORD' | string;
  acceptedAt?: unknown;
  respondedAt?: unknown;
  /** El servidor cerró el seguimiento (fichó, hueco terminado o cancelada). */
  followUpClosedAt?: unknown;
  followUpClosedReason?: string;
  /** Fin del hueco. */
  gapEndAt?: unknown;
  endTime?: unknown;
};

export type TurnoPresenciaLike = {
  id?: string;
  employeeId?: string;
  absenceShiftId?: string;
  coverageForShiftId?: string;
  coveredShiftId?: string;
  isPresent?: boolean;
  status?: string;
  isDeleted?: boolean;
  checkInAt?: unknown;
  checkInTime?: unknown;
  realStartTime?: unknown;
};

function turnoFichado(shift: TurnoPresenciaLike): boolean {
  if (shift.isDeleted === true) return false;
  const st = String(shift.status || '').toUpperCase();
  if (st === 'CANCELLED' || st === 'DELETED') return false;
  return shift.isPresent === true
    || st === 'PRESENT'
    || timestampLikeToMillis(shift.checkInAt) > 0
    || timestampLikeToMillis(shift.checkInTime) > 0
    || timestampLikeToMillis(shift.realStartTime) > 0;
}

/** Mismo id que `buildOpsCoverageDocId` del servidor. */
export function opsCoverageDocId(titularShiftId: string, employeeId: string): string {
  return `ops_cov_${titularShiftId}_${employeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

/** El hueco ya pasó: no queda tarjeta de «¿venís?». */
export function huecoTerminado(
  c: { gapEndAt?: unknown; endTime?: unknown } | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!c) return false;
  const end = timestampLikeToMillis(c.gapEndAt) || timestampLikeToMillis(c.endTime);
  return end > 0 && end <= nowMs;
}

/**
 * El guardia ya está en el puesto de ese hueco: fichó el ops_cov,
 * el turno del hueco, o un turno suyo que lo cubre.
 */
export function guardiaPresenteEnHueco(
  shifts: TurnoPresenciaLike[] | null | undefined,
  huecoShiftId: string | null | undefined,
  employeeId: string | null | undefined,
): boolean {
  const hueco = String(huecoShiftId || '').trim();
  if (!hueco || !shifts?.length) return false;
  const emp = String(employeeId || '').trim();
  const covId = emp ? opsCoverageDocId(hueco, emp) : '';
  return shifts.some((shift) => {
    if (!turnoFichado(shift)) return false;
    if (covId && shift.id === covId) return true;
    if (shift.id === hueco && (!emp || !shift.employeeId || shift.employeeId === emp)) return true;
    const link = String(shift.absenceShiftId || shift.coverageForShiftId || shift.coveredShiftId || '').trim();
    if (link !== hueco) return false;
    return !emp || !shift.employeeId || shift.employeeId === emp;
  });
}

export function isConvocadoEta(value: number): value is ConvocadoEtaMinutes {
  return value === 10 || value === 15 || value === 30;
}

/**
 * Pendiente = ACCEPTED + reminderSentAt presente + sin respuesta posterior + sin fichar.
 * Respondió si convocadoReplyAt >= reminderSentAt.
 */
export function isRecordatorioPendiente(
  c: RecordatorioConvocadoLike | null | undefined,
  shiftCheckedIn = false,
): boolean {
  if (!c || shiftCheckedIn) return false;
  const type = String(c.type || '').trim().toUpperCase();
  if (type === 'LLEGADA_TARDE' || type === 'EXTEND') return false;
  if (String(c.status || '').trim().toUpperCase() !== 'ACCEPTED') return false;
  if (timestampLikeToMillis(c.followUpClosedAt) > 0) return false;
  if (huecoTerminado(c)) return false;
  const sentMs = timestampLikeToMillis(c.reminderSentAt);
  if (sentMs <= 0) return false;
  const gap = timestampLikeToMillis(c.gapStartAt) || timestampLikeToMillis((c as { startTime?: unknown }).startTime);
  // REF/ESC: nada de «¿Seguís en camino?» con el hueco a más de 5 min. El RET directo sí
  // usa el recordatorio del convocado (puede caer antes de T−5).
  if (c.escenarioCobertura === 'ANTICIPADA' || c.coberturaAnticipada === true) return false;
  if (type !== 'RET' && type !== 'REF' && type !== 'ESC' && gap > Date.now() + 5 * 60_000) return false;
  const replyMs = timestampLikeToMillis(c.convocadoReplyAt);
  if (replyMs > 0 && replyMs >= sentMs) return false;
  return true;
}

export function parseConvocadoRecordatorioPush(
  data: Record<string, unknown> | null | undefined,
): { convocatoriaId: string; etaMinutes: number | null } | null {
  if (!data) return null;
  const type = String(data.type ?? data.tipo ?? '')
    .trim()
    .toUpperCase();
  if (type !== 'CONVOCADO_RECORDATORIO') return null;
  const convocatoriaId = String(data.convocatoriaId ?? '').trim();
  if (!convocatoriaId) return null;
  const etaRaw = Number(data.etaMinutes);
  const etaMinutes = Number.isFinite(etaRaw) && etaRaw > 0 ? Math.round(etaRaw) : null;
  return { convocatoriaId, etaMinutes };
}

export function convocadoRecordatorioRoute(parsed: {
  convocatoriaId: string;
  etaMinutes?: number | null;
}): string {
  const q = new URLSearchParams();
  q.set('focus', 'recordatorio');
  q.set('convocatoriaId', parsed.convocatoriaId);
  if (parsed.etaMinutes != null && Number.isFinite(parsed.etaMinutes)) {
    q.set('etaMinutes', String(parsed.etaMinutes));
  }
  return `/(tabs)?${q.toString()}`;
}

/** `expectedArrivalAt` del servidor; si falta, `etaMinutes` desde el ancla (aceptación o ahora). */
export function resolveExpectedArrivalAt(input: {
  expectedArrivalAt?: unknown;
  etaMinutes?: number | null;
  anchorMs?: number;
  nowMs: number;
}): Date | null {
  const explicit = timestampLikeToMillis(input.expectedArrivalAt);
  if (explicit > 0) return new Date(explicit);
  const eta = input.etaMinutes;
  if (eta != null && Number.isFinite(eta) && eta > 0) {
    const anchor = input.anchorMs && input.anchorMs > 0 ? input.anchorMs : input.nowMs;
    return new Date(anchor + Math.round(eta) * 60_000);
  }
  return null;
}

export function formatEnCaminoLine(objectiveName: string, eta: Date | null): string {
  const place = objectiveName.trim() || 'el objetivo';
  if (!eta) return `EN CAMINO a ${place}`;
  return `EN CAMINO a ${place} · llegada estimada ${formatTimeAr(eta)}`;
}

function arDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Antes de salir: próximo turno, no “en camino”. */
export function coberturaAceptadaLine(input: {
  gapStart: Date;
  gapEnd?: Date | null;
  now: Date;
  objectiveName?: string;
  positionName?: string;
}): string {
  const day = arDay(input.gapStart) === arDay(input.now) ? 'hoy' : arDay(input.gapStart).split('-').reverse().join('/');
  const end = input.gapEnd ? `–${formatTimeAr(input.gapEnd)}` : '';
  const place = [input.objectiveName, input.positionName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
  return `Cobertura aceptada · ${day} ${formatTimeAr(input.gapStart)}${end}${place ? ` · ${place}` : ''}`;
}

/** Más de este margen antes del inicio: la cobertura es un cambio de planificación. */
export const UMBRAL_COBERTURA_ANTICIPADA_MIN = 60;

export type EscenarioCobertura = 'ANTICIPADA' | 'URGENTE';

/** Espejo de `escenarioCobertura` en functions. */
export function escenarioCobertura(input: {
  gapStartMs: number;
  nowMs: number;
  umbralMin?: number | null;
}): EscenarioCobertura {
  const raw = Number(input.umbralMin);
  const umbral = Number.isFinite(raw) && raw >= 0 ? raw : UMBRAL_COBERTURA_ANTICIPADA_MIN;
  const gap = input.gapStartMs;
  const now = input.nowMs;
  if (gap > 0 && now > 0 && gap - now > umbral * 60_000) return 'ANTICIPADA';
  return 'URGENTE';
}

/** Espejo de `planConvocadoArrival` en functions (paridad). */
export function planConvocadoArrival(input: {
  acceptedAtMs: number;
  gapStartMs: number;
  etaMinutes: number;
  escenario?: EscenarioCobertura | null;
}): {
  future: boolean;
  expectedArrivalMs: number;
  reminderAtMs: number;
  departAtMs: number;
  punchOpenMs: number;
} {
  const eta = Math.max(1, Math.round(Number(input.etaMinutes) || 0));
  const travelMs = eta * 60_000;
  const accepted = input.acceptedAtMs;
  const gap = input.gapStartMs;
  if (input.escenario === 'URGENTE') {
    return {
      future: false,
      expectedArrivalMs: accepted + travelMs,
      reminderAtMs: accepted + Math.round((eta * 2) / 3) * 60_000,
      departAtMs: accepted,
      punchOpenMs: accepted,
    };
  }
  if (input.escenario === 'ANTICIPADA') {
    return {
      future: false,
      expectedArrivalMs: gap,
      reminderAtMs: 0,
      departAtMs: gap,
      punchOpenMs: gap > 0 ? gap - 15 * 60_000 : accepted,
    };
  }
  const future = gap > 0 && accepted > 0 && gap > accepted + travelMs;
  if (!future) {
    return {
      future: false,
      expectedArrivalMs: accepted + travelMs,
      reminderAtMs: accepted + Math.round((eta * 2) / 3) * 60_000,
      departAtMs: accepted,
      punchOpenMs: accepted,
    };
  }
  let reminderAtMs = gap - travelMs - 10 * 60_000;
  const tMinus5 = gap - 5 * 60_000;
  if (reminderAtMs <= accepted) reminderAtMs = tMinus5 > accepted ? tMinus5 : accepted + 60_000;
  return {
    future: true,
    expectedArrivalMs: gap,
    reminderAtMs,
    departAtMs: gap - travelMs,
    punchOpenMs: gap - 15 * 60_000,
  };
}

export function mapsSearchUrl(
  lat?: number | null,
  lng?: number | null,
  address?: string | null,
): string | null {
  if (lat != null && lng != null && Number(lat) !== 0 && Number(lng) !== 0) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
  const addr = String(address || '').trim();
  if (!addr) return null;
  return `https://www.google.com/maps/search/${encodeURIComponent(addr)}`;
}

type DutyShift = {
  origin?: string;
  coverageHoursOnSource?: boolean;
  coverageType?: string;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  isAdvanced?: boolean;
  extendedUntil?: unknown;
  endTime?: unknown;
  adjustedStartTime?: unknown;
  startTime?: unknown;
};

export function isExtendedDutyShift(shift: DutyShift | null | undefined): boolean {
  if (!shift || isCoverageHoursOnSourceDoc(shift as Record<string, unknown>)) return false;
  if (shift.isExtended === true) return true;
  const ct = String(shift.coverageType || '').toUpperCase();
  return ct === 'EXTEND' || ct === 'EXT';
}

export function isAdvanceDutyShift(shift: DutyShift | null | undefined): boolean {
  if (!shift || isCoverageHoursOnSourceDoc(shift as Record<string, unknown>)) return false;
  if (shift.isEarlyStart === true || shift.isAdvanced === true) return true;
  const ct = String(shift.coverageType || '').toUpperCase();
  return ct === 'ADVANCE' || ct === 'ADV';
}

export function extendUntilLine(shift: DutyShift | null | undefined): string | null {
  if (!shift || !isExtendedDutyShift(shift)) return null;
  const d = toDate((shift.extendedUntil ?? shift.endTime) as never);
  if (!d) return null;
  return `Extendido hasta ${formatTimeAr(d)}`;
}

export function advanceStartLine(shift: DutyShift | null | undefined): string | null {
  if (!shift || !isAdvanceDutyShift(shift)) return null;
  const raw = shift.adjustedStartTime;
  if (typeof raw === 'string' && /^\d{1,2}:\d{2}$/.test(raw.trim())) {
    const [hh, mm] = raw.trim().split(':');
    return `Inicio adelantado ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
  }
  const d = toDate(raw as never);
  if (!d) return null;
  return `Inicio adelantado ${formatTimeAr(d)}`;
}
