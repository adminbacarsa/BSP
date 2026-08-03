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

export function shiftOwnedByEmployee(
  shift: Shift,
  empDocId: string | null | undefined,
  authUid: string | null | undefined,
): boolean {
  const id = String(shift.employeeId ?? '').trim();
  if (!id) return false;
  if (empDocId?.trim() && id === empDocId.trim()) return true;
  if (authUid?.trim() && id === authUid.trim()) return true;
  return false;
}

export function heroShift(
  shifts: Shift[],
  now = new Date(),
  owner?: { empDocId?: string | null; authUid?: string | null },
): Shift | undefined {
  const scoped =
    owner?.empDocId || owner?.authUid
      ? shifts.filter((s) => shiftOwnedByEmployee(s, owner.empDocId, owner.authUid))
      : shifts;
  return pickTodayWorkShift(scoped, now) ?? pickNextShift(scoped, now);
}
