/**
 * ops_cov EXT/ADV de registro (coverageHoursOnSource): trazabilidad; el guardia ficha su turno propio.
 * No participan en ausencias automáticas, retención ni listas operativas como titular fichable.
 */
export function isOpsCoverageHoursOnSourceDoc(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (data.coverageHoursOnSource === true) return true;
  const ct = String(data.coverageType || '').toUpperCase();
  if (
    String(data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE'
    && (ct === 'EXTEND' || ct === 'ADVANCE')
  ) {
    return true;
  }
  return false;
}

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
 * Franco origen de una cobertura: el día F (o el F ya pasado a FT) que apunta al ops_cov.
 * No es el turno que el guardia ficha. El titular cubierto (M/T/N con coverageDocId) no entra.
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

/** Excluir de detectarAusencias, trigger ausencia, vacantes, auto-completar y retención por hueco. */
export function skipAbsencePipelineForShift(data: Record<string, unknown> | null | undefined): boolean {
  if (isFrancoCoverageOriginDoc(data)) return true;
  if (isOpsCoverageHoursOnSourceDoc(data)) return true;
  if (data?.isDeleted === true) return true;
  // Turno origen RET con coverageUsed; EXT/ADV marcan isExtended/isEarlyStart (sin coverageUsed).
  if (data?.isExtended === true || data?.isEarlyStart === true) return false;
  return data?.coverageUsed === true;
}
