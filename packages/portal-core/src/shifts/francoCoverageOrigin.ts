function instantMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === 'object') {
    const o = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o.toDate === 'function') return o.toDate().getTime();
    const sec = o.seconds ?? o._seconds;
    if (typeof sec === 'number') return sec * 1000;
  }
  return 0;
}

/** Franco de calendario (00:00–23:59 AR), no una jornada de puesto. */
export function isCalendarFrancoSpan(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const start = instantMs(data.startTime ?? data.shiftDateObj);
  const end = instantMs(data.endTime ?? data.endDateObj);
  if (!start || !end || end <= start) return false;
  const span = end - start;
  if (span < 23.5 * 3600000 || span > 24.5 * 3600000) return false;
  const fromMidnight = (start + 3 * 3600000) % (24 * 3600000);
  return fromMidnight < 2 * 60 * 1000;
}

/**
 * Franco origen de una cobertura. El turno que se ficha es el ops_cov.
 * Un M/T/N cubierto (coverageDocId en el titular) no es este doc.
 */
export function isFrancoCoverageOriginDoc(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return false;
  const code = String(data.code || data.shiftCode || '').trim().toUpperCase();
  const francoCode = data.isFranco === true || code === 'F' || code === 'FF' || code === 'FP';
  const linked = String(data.coverageDocId || '').trim().length > 0 || data.coverageUsed === true;
  const comment = /franco trabajado\s*\(cobertura/i.test(String(data.comments || ''));
  const fullDay = isCalendarFrancoSpan(data);
  const converted = data.isFrancoTrabajado === true || (code === 'FT' && (comment || fullDay));
  if (linked && (francoCode || converted || comment)) return true;
  if (converted && fullDay) return true;
  if (francoCode && fullDay && linked) return true;
  return false;
}
