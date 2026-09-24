/** Códigos CCT / grilla que son ausencia o licencia (no se ficha). */
const LEAVE_SHIFT_CODES = new Set([
  'AA',
  'V',
  'L',
  'E',
  'A',
  'ART',
  'PG',
  'SGS',
  'SUS',
]);

/**
 * Detecta turno del titular que NO debe mostrarse como "próximo a trabajar".
 * Cubre docs nuevos, aliases y coberturas ops sin isAbsent.
 */
export function isAbsentLikeShift(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift) return false;

  const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

  if (truthy(shift.isAbsent) || truthy(shift.isAusente) || truthy(shift.ausente)) return true;

  const status = String(shift.status || shift.estado || '').trim().toUpperCase();
  if (
    status === 'ABSENT' ||
    status === 'AUSENTE' ||
    status === 'ABSENCE' ||
    status.includes('AUSENT') ||
    status.includes('ABSENT')
  ) {
    return true;
  }

  const absType = String(
    shift.absenceType || shift.tipoAusencia || shift.tipoNovedad || shift.novedadCode || '',
  )
    .trim()
    .toUpperCase();
  if (
    LEAVE_SHIFT_CODES.has(absType) ||
    absType === 'AUSENCIA' ||
    absType === 'NO_PRESENTACION' ||
    absType === 'NO_PRESENTACIÓN' ||
    absType === 'NO PRESENTACION' ||
    absType === 'MANUAL_OPS'
  ) {
    return true;
  }

  const code = String(shift.code || shift.codigo || '')
    .trim()
    .toUpperCase();
  if (LEAVE_SHIFT_CODES.has(code)) return true;

  const planned = String(shift.plannedNovedad || shift.plannedNovedadCode || '')
    .trim()
    .toUpperCase();
  if (LEAVE_SHIFT_CODES.has(planned) || planned === 'AUSENCIA') return true;

  // Typo histórico: operacionally (cion) vs operationally (tion)
  if (
    truthy(shift.operacionallyCovered) ||
    truthy(shift.operationallyCovered) ||
    truthy(shift.plannedOperativelyCovered)
  ) {
    return true;
  }

  if (shift.coveredByEmployeeId || shift.coveredByEmployeeName || shift.coveredBy) {
    return true;
  }

  const covStatus = String(
    shift.coverageStatus || shift.coberturaEstado || shift.coberturaStatus || '',
  )
    .trim()
    .toUpperCase();
  if (covStatus === 'COVERED' || covStatus === 'CUBIERTO' || covStatus === 'GESTIONADA') {
    return true;
  }

  return false;
}

/** Ausencia RRHH activa (no rechazada) que invalida el turno del titular. */
/** LT = llegada tarde: novedad RRHH del guardia que SÍ trabajó, no una ausencia. */
function isLateArrivalRecord(data: Record<string, unknown>): boolean {
  const code = String(data.absenceType || data.code || '').trim().toUpperCase();
  const type = String(data.type || '').trim().toLowerCase();
  return code === 'LT' || type === 'llegada tarde' || String(data.origin || '').toUpperCase() === 'LATE_ARRIVAL';
}

export function isActiveAbsenceRecord(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (isLateArrivalRecord(data)) return false;
  const st = String(data.status || data.estado || '')
    .trim()
    .toUpperCase();
  if (
    st === 'RECHAZADA' ||
    st === 'REJECTED' ||
    st === 'CANCELADA' ||
    st === 'CANCELLED' ||
    st === 'ANULADA' ||
    st === 'INACTIVE' ||
    st === 'INACTIVA'
  ) {
    return false;
  }
  return true;
}
