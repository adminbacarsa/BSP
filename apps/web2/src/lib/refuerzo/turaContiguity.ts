import { hoursFromShiftClock } from './refuerzoDisplay';

const DEFAULT_GAP_THRESHOLD_MIN = 15;

export type ShiftClockLike = {
  startTime?: unknown;
  endTime?: unknown;
  hours?: unknown;
  fecha?: string;
};

function instantFromClock(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    const d = (val as { toDate: () => Date }).toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = (val as { seconds?: number; _seconds?: number }).seconds
    ?? (val as { _seconds?: number })._seconds;
  if (typeof sec === 'number' && sec > 0) return new Date(sec * 1000);
  if (typeof val === 'string') {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseHmToMinutes(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Resuelve fin/inicio efectivo de un turno (ISO, Timestamp o HH:mm + fecha). */
export function resolveShiftEndInstant(shift: ShiftClockLike | null | undefined): Date | null {
  if (!shift) return null;
  const direct = instantFromClock(shift.endTime);
  if (direct) return direct;
  const endMin = parseHmToMinutes(shift.endTime);
  const start = instantFromClock(shift.startTime);
  const fecha = String(shift.fecha || '').slice(0, 10);
  if (endMin != null && fecha) {
    const [y, mo, d] = fecha.split('-').map(Number);
    return new Date(y, (mo || 1) - 1, d || 1, Math.floor(endMin / 60), endMin % 60, 0, 0);
  }
  if (endMin != null && start) {
    const out = new Date(start);
    out.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
    if (out <= start) out.setDate(out.getDate() + 1);
    return out;
  }
  return null;
}

export function resolveShiftStartInstant(shift: ShiftClockLike | null | undefined): Date | null {
  if (!shift) return null;
  const direct = instantFromClock(shift.startTime);
  if (direct) return direct;
  const startMin = parseHmToMinutes(shift.startTime);
  const fecha = String(shift.fecha || '').slice(0, 10);
  if (startMin != null && fecha) {
    const [y, mo, d] = fecha.split('-').map(Number);
    return new Date(y, (mo || 1) - 1, d || 1, Math.floor(startMin / 60), startMin % 60, 0, 0);
  }
  return null;
}

/** Minutos entre fin del turno base e inicio del TURA. Negativo = solapamiento. */
export function gapMinutesBetweenParentAndTura(
  parent: ShiftClockLike | null | undefined,
  tura: ShiftClockLike | null | undefined,
): number | null {
  const parentEnd = resolveShiftEndInstant(parent);
  const turaStart = resolveShiftStartInstant(tura);
  if (!parentEnd || !turaStart) return null;
  return (turaStart.getTime() - parentEnd.getTime()) / 60000;
}

/** Seguido si gap ≤ umbral (default 15 min). */
export function isTuraContiguousToParent(
  parent: ShiftClockLike | null | undefined,
  tura: ShiftClockLike | null | undefined,
  thresholdMin: number = DEFAULT_GAP_THRESHOLD_MIN,
): boolean {
  const gap = gapMinutesBetweenParentAndTura(parent, tura);
  if (gap === null) return false;
  return gap <= thresholdMin;
}

export function formatShiftClockRange(shift: ShiftClockLike | null | undefined): string {
  if (!shift) return '';
  const fmt = (d: Date | null) => {
    if (!d) return '';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const start = resolveShiftStartInstant(shift);
  const end = resolveShiftEndInstant(shift);
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a}–${b}`;
  return a || b || '';
}

export function combinedContiguousRangeLabel(
  parent: ShiftClockLike | null | undefined,
  tura: ShiftClockLike | null | undefined,
): string {
  const start = resolveShiftStartInstant(parent);
  const end = resolveShiftEndInstant(tura);
  const fmt = (d: Date | null) => {
    if (!d) return '';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a}–${b}`;
  return a || b || '';
}

export function turaBillableHours(tura: ShiftClockLike | null | undefined): number {
  return hoursFromShiftClock(tura || {});
}
