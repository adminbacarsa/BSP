import type { Shift } from '@cosp/portal-types';
import { toDate } from '@cosp/portal-core';

export function sortShiftsByStart(shifts: Shift[]): Shift[] {
  return [...shifts].sort((a, b) => {
    const ad = toDate(a.startTime)?.getTime() ?? 0;
    const bd = toDate(b.startTime)?.getTime() ?? 0;
    return ad - bd;
  });
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function pickTodayShiftAny(shifts: Shift[], now = new Date()): Shift | undefined {
  const sorted = sortShiftsByStart(shifts);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return sorted.find((s) => {
    const start = toDate(s.startTime);
    const end = toDate(s.endTime);
    if (!start || start < startOfDay || start > endOfDay) return false;
    if (end && end < now) return false;
    return true;
  });
}

export function pickTodayWorkShift(shifts: Shift[], now = new Date()): Shift | undefined {
  const today = pickTodayShiftAny(shifts, now);
  return today && !today.isFranco ? today : undefined;
}

export function pickNextShift(shifts: Shift[], now = new Date()): Shift | undefined {
  const sorted = sortShiftsByStart(shifts);
  const today = dateKey(now);
  return sorted.find((s) => {
    const start = toDate(s.startTime);
    return start && dateKey(start) > today && !s.isFranco;
  });
}

export function heroShift(shifts: Shift[], now = new Date()): Shift | undefined {
  return pickTodayWorkShift(shifts, now) ?? pickNextShift(shifts, now);
}
