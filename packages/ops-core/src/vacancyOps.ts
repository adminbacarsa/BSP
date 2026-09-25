export const VACANCY_DESCUBIERTO_RATIO = 0.55;

export function getVacancyElapsedRatio(
  s: { shiftDateObj?: Date | null; endDateObj?: Date | null },
  now: Date = new Date(),
): number | null {
  const start = s?.shiftDateObj instanceof Date ? s.shiftDateObj : null;
  const end = s?.endDateObj instanceof Date ? s.endDateObj : null;
  if (!start || !end) return null;
  let startMs = start.getTime();
  let endMs = end.getTime();
  if (endMs <= startMs) endMs += 86400000;
  const dur = endMs - startMs;
  if (dur <= 0) return null;
  return (now.getTime() - startMs) / dur;
}

export function isVacancyDescubierto(
  s: Record<string, unknown> & { shiftDateObj?: Date; endDateObj?: Date; isUnassigned?: boolean },
  now: Date = new Date(),
): boolean {
  if (!s?.isUnassigned) return false;
  if (s.isSinCobertura || s.status === 'SIN_COBERTURA') return true;
  if (typeof s.isDescubierto === 'boolean') return s.isDescubierto;
  const ratio = getVacancyElapsedRatio(s, now);
  if (ratio == null) return false;
  return ratio >= VACANCY_DESCUBIERTO_RATIO;
}

export function isActionableOpsVacancy(
  s: Record<string, unknown> & { shiftDateObj?: Date; endDateObj?: Date; isUnassigned?: boolean },
  now: Date = new Date(),
): boolean {
  if (!s?.isUnassigned) return false;
  if (s.isReportedToPlanning || s.status === 'REPORTED_TO_PLANNING' || s.isReported === true) return false;
  if (isVacancyDescubierto(s, now)) return false;
  return true;
}
