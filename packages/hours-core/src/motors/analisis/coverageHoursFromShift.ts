const LEAVE_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'SGS', 'SUS']);
const BAND_HOURS: Record<string, number> = {
  M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, EN: 9, REF: 8, RFZ: 8, C: 8, GU: 8, ESC: 8,
};
const JORNADA_DEFAULT_HS = 8;
const FULL_CALENDAR_DAY_HS = 23.5;

export function coverageHoursFromShift(t: any): number {
  if (!t) return JORNADA_DEFAULT_HS;
  if (
    t.coverageHoursOnSource === true
    || (String(t.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE'
      && ['EXTEND', 'ADVANCE'].includes(String(t.coverageType || '').toUpperCase()))
  ) {
    return 0;
  }
  const code = String(t.code || t.shiftCode || '').toUpperCase();
  const isLeave = LEAVE_CODES.has(code);
  const stored = Number(t.hours);
  if (Number.isFinite(stored) && stored >= 0.5 && stored < FULL_CALENDAR_DAY_HS) {
    return Math.min(stored, isLeave ? 12 : 24);
  }
  if (!isLeave && BAND_HOURS[code] != null) return BAND_HOURS[code];
  if (!isLeave && t.startTime?.seconds && t.endTime?.seconds) {
    const dur = (t.endTime.seconds - t.startTime.seconds) / 3600;
    if (dur >= 0.5 && dur < FULL_CALENDAR_DAY_HS) return Math.min(dur, 24);
  }
  if (BAND_HOURS[code] != null && BAND_HOURS[code] > 0) return BAND_HOURS[code];
  return JORNADA_DEFAULT_HS;
}
