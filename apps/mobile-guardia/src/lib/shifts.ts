import type { Shift } from '@cosp/portal-types';
import * as hero from './heroShiftSelection';

export const isRestFrancoShift = hero.isRestFrancoShift;
export const isOperationsCoverageHeroShift = hero.isOperationsCoverageHeroShift;

export function sortShiftsByStart(shifts: Shift[]): Shift[] {
  return hero.sortShiftsByStart(shifts);
}

export function isActiveRetentionShift(shift: Shift | null | undefined): boolean {
  return hero.isActiveRetentionShift(shift);
}

export function pickTodayShiftAny(shifts: Shift[], now = new Date()): Shift | undefined {
  return hero.pickTodayShiftAny(shifts, now);
}

export function pickTodayWorkShift(shifts: Shift[], now = new Date()): Shift | undefined {
  return hero.pickTodayWorkShift(shifts, now);
}

export function pickNextShift(shifts: Shift[], now = new Date()): Shift | undefined {
  return hero.pickNextShift(shifts, now);
}

export function pickTodayAbsentShift(shifts: Shift[], now = new Date()): Shift | undefined {
  return hero.pickTodayAbsentShift(shifts, now);
}

export function isShiftInProgress(shift: Shift, now = new Date()): boolean {
  return hero.isShiftInProgress(shift, now);
}

export function shiftStartsToday(shift: Shift, now = new Date()): boolean {
  return hero.shiftStartsToday(shift, now);
}

export function shiftOwnedByEmployee(
  shift: Shift,
  empDocId: string | null | undefined,
  authUid: string | null | undefined,
): boolean {
  return hero.shiftOwnedByEmployee(shift, empDocId, authUid);
}

export function heroShift(
  shifts: Shift[],
  now = new Date(),
  owner?: { empDocId?: string | null; authUid?: string | null },
): Shift | undefined {
  return hero.heroShift(shifts, now, owner);
}
