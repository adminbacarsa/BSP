import type { ShiftVariant } from '@/services/slaService';

export const SLA_SHIFT_WD_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export function isSpecificDateShift(shift: ShiftVariant): boolean {
  return Array.isArray(shift.specificDates) && shift.specificDates.length > 0;
}

export function buildShiftsByDateMap(shifts: ShiftVariant[]): Map<string, ShiftVariant[]> {
  const map = new Map<string, ShiftVariant[]>();
  for (const shift of shifts) {
    if (!isSpecificDateShift(shift)) continue;
    for (const ds of shift.specificDates || []) {
      if (!map.has(ds)) map.set(ds, []);
      map.get(ds)!.push(shift);
    }
  }
  return map;
}

export function shiftHasDate(shift: ShiftVariant, dateStr: string): boolean {
  return Array.isArray(shift.specificDates) && shift.specificDates.includes(dateStr);
}

export function toggleShiftDate(
  shifts: ShiftVariant[],
  code: string,
  dateStr: string,
): ShiftVariant[] {
  return shifts.map((shift) => {
    if (shift.code !== code) return shift;
    const current = shift.specificDates || [];
    const hasWeekdays = Array.isArray(shift.days) && shift.days.length > 0;
    if (current.length === 0 && hasWeekdays) {
      const next = [dateStr].sort();
      const { days: _days, ...rest } = shift;
      return { ...rest, specificDates: next };
    }
    const next = current.includes(dateStr)
      ? current.filter((d) => d !== dateStr)
      : [...current, dateStr].sort();
    const { days: _days, ...rest } = shift;
    return {
      ...rest,
      specificDates: next,
    };
  });
}

export function validateCustomShiftDates(
  shifts: ShiftVariant[],
  code: string,
  dates: string[],
  editingCode: string | null,
): string | null {
  if (dates.length === 0) return 'Seleccioná al menos una fecha';
  const other = shifts.filter((s) => s.code !== (editingCode ?? code));
  if (!editingCode && other.some((s) => s.code === code)) {
    return `Ya existe un turno con sigla ${code}`;
  }
  for (const ds of dates) {
    if (other.some((s) => s.code === code && shiftHasDate(s, ds))) {
      return `La sigla ${code} ya está asignada el ${ds}`;
    }
  }
  return null;
}

export function sortYmdDates(dates: string[]): string[] {
  return [...dates].sort();
}
