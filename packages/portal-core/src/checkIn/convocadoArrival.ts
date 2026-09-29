import { formatTimeAr, toDate } from '../utils/dates';
import { isCoverageHoursOnSourceDoc, timestampLikeToMillis } from './evaluateCheckInWindow';

export const CONVOCADO_ETA_OPTIONS = [10, 15, 30] as const;
export type ConvocadoEtaMinutes = (typeof CONVOCADO_ETA_OPTIONS)[number];

export type RecordatorioConvocadoLike = {
  id?: string;
  status?: string;
  type?: string;
  recordatorioPendiente?: boolean;
  recordatorioStatus?: string;
  reminderStatus?: string;
  checkedIn?: boolean;
  fichado?: boolean;
  etaMinutes?: number;
  llegadaEstimadaAt?: unknown;
  respondedAt?: unknown;
  objectiveName?: string;
  objectiveLat?: number;
  objectiveLng?: number;
  shiftId?: string;
};

const RESPONDED_REMINDER = new Set(['ON_WAY', 'PROBLEM', 'DONE', 'RESPONDED']);

export function isConvocadoEta(value: number): value is ConvocadoEtaMinutes {
  return value === 10 || value === 15 || value === 30;
}

/** Aceptada, sin fichar, y el servidor marcó el recordatorio como pendiente. */
export function isRecordatorioPendiente(
  c: RecordatorioConvocadoLike | null | undefined,
  shiftCheckedIn = false,
): boolean {
  if (!c || shiftCheckedIn || c.checkedIn === true || c.fichado === true) return false;
  if (String(c.type || '').trim().toUpperCase() === 'LLEGADA_TARDE') return false;
  if (String(c.status || '').trim().toUpperCase() !== 'ACCEPTED') return false;
  const rec = String(c.recordatorioStatus || c.reminderStatus || '')
    .trim()
    .toUpperCase();
  if (RESPONDED_REMINDER.has(rec)) return false;
  if (c.recordatorioPendiente === false) return false;
  return c.recordatorioPendiente === true || rec === 'PENDING' || rec === 'SENT';
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

export function resolveLlegadaEstimadaAt(input: {
  llegadaEstimadaAt?: unknown;
  etaMinutes?: number | null;
  anchorMs?: number;
  nowMs: number;
}): Date | null {
  const explicit = timestampLikeToMillis(input.llegadaEstimadaAt);
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
