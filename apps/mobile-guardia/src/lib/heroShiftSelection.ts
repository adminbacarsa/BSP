/** Selección de hero Hoy — puro (sin Firebase / portal-core) para tests Node. */

export type HeroShiftLike = {
  id: string;
  employeeId?: string | null;
  code?: string | null;
  origin?: string | null;
  isFranco?: boolean | null;
  isFrancoTrabajado?: boolean | null;
  isRetention?: boolean | null;
  isPresent?: boolean | null;
  isCompleted?: boolean | null;
  isAbsent?: boolean | null;
  status?: string | null;
  coverageHoursOnSource?: boolean | null;
  startTime?: unknown;
  endTime?: unknown;
  [key: string]: unknown;
};

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object' && val !== null && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (typeof val === 'object' && val !== null) {
    const seconds = (val as { seconds?: number; _seconds?: number }).seconds
      ?? (val as { _seconds?: number })._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
  }
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isAbsentLikeShift(shift: HeroShiftLike): boolean {
  if (shift.isAbsent === true) return true;
  const status = String(shift.status || '').toUpperCase();
  return status === 'ABSENT' || status === 'AUSENTE';
}

function isCoverageHoursOnSourceShift(shift: HeroShiftLike): boolean {
  if (shift.coverageHoursOnSource !== true) return false;
  return String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
}

export function sortShiftsByStart<T extends HeroShiftLike>(shifts: T[]): T[] {
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

/** Retenido presente: sigue siendo hero aunque haya pasado endTime (Flujo 12). */
export function isActiveRetentionShift(shift: HeroShiftLike | null | undefined): boolean {
  if (!shift) return false;
  return (
    shift.isRetention === true &&
    shift.isPresent === true &&
    shift.isCompleted !== true &&
    !isAbsentLikeShift(shift)
  );
}

/** Franco de descanso (F/FF/FP); no FT ni cobertura ops. */
export function isRestFrancoShift(shift: HeroShiftLike | null | undefined): boolean {
  if (!shift) return false;
  if (String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return false;
  if (shift.isFrancoTrabajado === true) return false;
  const code = String(shift.code || '')
    .trim()
    .toUpperCase();
  if (code === 'FT') return false;
  if (shift.isFranco === true) return true;
  return code === 'F' || code === 'FF' || code === 'FP';
}

export function isOperationsCoverageHeroShift(shift: HeroShiftLike | null | undefined): boolean {
  if (!shift) return false;
  if (String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (isCoverageHoursOnSourceShift(shift)) return false;
  return true;
}

function isHeroCandidate(s: HeroShiftLike): boolean {
  if (isAbsentLikeShift(s)) return false;
  if (isCoverageHoursOnSourceShift(s)) return false;
  return true;
}

function startsOnLocalDay(shift: HeroShiftLike, now: Date): boolean {
  const start = toDate(shift.startTime);
  if (!start) return false;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return start >= startOfDay && start <= endOfDay;
}

function isStillActiveToday(shift: HeroShiftLike, now: Date): boolean {
  if (!startsOnLocalDay(shift, now)) return false;
  if (!isHeroCandidate(shift)) return false;
  if (isActiveRetentionShift(shift)) return true;
  const end = toDate(shift.endTime);
  if (end && end.getTime() <= now.getTime()) return false;
  return true;
}

export function isShiftInProgress(shift: HeroShiftLike, now = new Date()): boolean {
  const start = toDate(shift.startTime);
  const end = toDate(shift.endTime);
  if (!start) return false;
  const t = now.getTime();
  if (start.getTime() > t) return false;
  if (end && end.getTime() <= t) return false;
  return true;
}

export function pickTodayShiftAny<T extends HeroShiftLike>(shifts: T[], now = new Date()): T | undefined {
  const sorted = sortShiftsByStart(shifts);
  return sorted.find((s) => isStillActiveToday(s, now));
}

export function pickTodayWorkShift<T extends HeroShiftLike>(shifts: T[], now = new Date()): T | undefined {
  const today = sortShiftsByStart(shifts).filter(
    (s) => isStillActiveToday(s, now) && !isRestFrancoShift(s),
  );
  if (!today.length) return undefined;

  const inProgress = today.filter((s) => isShiftInProgress(s, now) || isActiveRetentionShift(s));
  const opsInProgress = inProgress.find((s) => isOperationsCoverageHeroShift(s));
  if (opsInProgress) return opsInProgress;

  if (inProgress.length === 1) return inProgress[0];
  if (inProgress.length > 1) {
    return sortShiftsByStart(inProgress).at(-1) ?? inProgress[0];
  }

  return today[0];
}

export function pickNextShift<T extends HeroShiftLike>(shifts: T[], now = new Date()): T | undefined {
  const sorted = sortShiftsByStart(shifts);
  const t = now.getTime();
  return sorted.find((s) => {
    if (isRestFrancoShift(s) || !isHeroCandidate(s)) return false;
    const start = toDate(s.startTime);
    return !!start && start.getTime() > t;
  });
}

export function pickTodayAbsentShift<T extends HeroShiftLike>(shifts: T[], now = new Date()): T | undefined {
  const sorted = sortShiftsByStart(shifts);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return sorted.find((s) => {
    if (!isAbsentLikeShift(s)) return false;
    const start = toDate(s.startTime);
    if (!start || start < startOfDay || start > endOfDay) return false;
    return true;
  });
}

export function shiftStartsToday(shift: HeroShiftLike, now = new Date()): boolean {
  const start = toDate(shift.startTime);
  return !!start && dateKey(start) === dateKey(now);
}

export function shiftOwnedByEmployee(
  shift: HeroShiftLike,
  empDocId: string | null | undefined,
  authUid: string | null | undefined,
): boolean {
  const id = String(shift.employeeId ?? '').trim();
  if (!id) return false;
  if (empDocId?.trim() && id === empDocId.trim()) return true;
  if (authUid?.trim() && id === authUid.trim()) return true;
  return false;
}

export function heroShift<T extends HeroShiftLike>(
  shifts: T[],
  now = new Date(),
  owner?: { empDocId?: string | null; authUid?: string | null },
): T | undefined {
  const scoped =
    owner?.empDocId || owner?.authUid
      ? shifts.filter((s) => shiftOwnedByEmployee(s, owner.empDocId, owner.authUid))
      : shifts;

  const retention = sortShiftsByStart(scoped).find((s) => isActiveRetentionShift(s));
  if (retention) return retention;

  return pickTodayWorkShift(scoped, now) ?? pickNextShift(scoped, now);
}
