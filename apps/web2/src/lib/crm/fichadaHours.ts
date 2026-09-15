import { toDateSafe } from './crmDateUtils';

/** Jornada de banda para una fichada (misma tabla que CRM pie / extracto). */
export const FICHADA_SHIFT_HOURS: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8,
};

const NON_WORKING_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA']);

export function isFichadaWorkingShiftCode(code: string): boolean {
  return !NON_WORKING_CODES.has((code || '').trim().toUpperCase());
}

export function fichadaDurationHours(start: Date, end: Date): number {
  const diff = (end.getTime() - start.getTime()) / 3600000;
  if (diff >= 0) return diff;
  return diff + 24;
}

export function isShiftAbsent(t: any): boolean {
  if (!t) return false;
  const st = String(t.status || '').toUpperCase();
  return t.isAbsent === true || st === 'ABSENT';
}

/** Presencia real: flags de fichada, presentAt consolidado, o par ingreso/egreso.
 *  Turno en curso (solo presentAt/check-in, sin cierre ni fin de banda) no cuenta como realizado del mes. */
export function isShiftFichado(t: any): boolean {
  if (!t || isShiftAbsent(t)) return false;
  const st = String(t.status || '').toUpperCase();
  if (t.isPresent === true || t.isCompleted === true || st === 'PRESENT' || st === 'COMPLETED') return true;
  const rs = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  const re = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  if (rs && re && re.getTime() > rs.getTime()) return true;

  const presentAt = toDateSafe(t.presentAt);
  if (!presentAt) return false;
  // presentAt + egreso / completado
  if (re || t.isCompleted === true || st === 'COMPLETED') return true;
  // presentAt y la banda planificada ya terminó → cuenta como realizado
  const plannedEnd = toDateSafe(t.endTime) || toDateSafe(t.plannedEndTime);
  if (plannedEnd && plannedEnd.getTime() < Date.now()) return true;
  return false;
}

export function fichadaAnchorDate(t: any): Date | null {
  return toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime) || toDateSafe(t.startTime);
}

/**
 * Horas de una fichada (banda M/T/N=8, D12/N12=12).
 * No inventa horas si el turno no está fichado.
 */
export function fichadaHoursForShift(t: any): number {
  if (!isShiftFichado(t)) return 0;
  const code = String((t.code || t.type || '')).trim().toUpperCase();
  if (!isFichadaWorkingShiftCode(code)) return 0;
  if (FICHADA_SHIFT_HOURS[code]) return FICHADA_SHIFT_HOURS[code];
  const stored = Number(t.hours);
  if (Number.isFinite(stored) && stored >= 0.5 && stored < 24) return Math.min(stored, 24);
  const rs = toDateSafe(t.realStartTime) || toDateSafe(t.checkInTime);
  const re = toDateSafe(t.realEndTime) || toDateSafe(t.checkOutTime);
  if (rs && re && re.getTime() > rs.getTime()) {
    const hrs = fichadaDurationHours(rs, re);
    if (hrs > 0 && hrs <= 24) return hrs;
  }
  return 8;
}
