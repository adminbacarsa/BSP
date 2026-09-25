/** ops_cov EXT/ADV: trazabilidad; horas en turno source (isExtended / isEarlyStart). */
export function isOpsCoverageHoursOnSourceDoc(
  data: Record<string, unknown> | null | undefined,
): boolean {
  if (!data) return false;
  if (data.coverageHoursOnSource === true) return true;
  const ct = String(data.coverageType || '').toUpperCase();
  if (String(data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE' && (ct === 'EXTEND' || ct === 'ADVANCE')) {
    return true;
  }
  return false;
}

export function isActiveOpsCoverageDoc(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (data.coverageSuperseded === true) return false;
  if (String(data.status || '').toUpperCase() === 'CANCELLED') return false;
  if (data.isDeleted === true) return false;
  return true;
}

export function computePlannedOperativelyCovered(shift: Record<string, unknown>): boolean {
  if (!shift) return false;
  if (shift.operacionallyCovered === true) return true;
  const isAbsent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  const role = String(shift.coverageSegmentRole || '');
  if (
    String(shift.coverageStatus || '').toUpperCase() === 'COVERED'
    && (role === 'TARGET' || isAbsent)
  ) {
    return true;
  }
  if (
    String(shift.coveredBy || '').trim()
    && String(shift.coverageStatus || '').toUpperCase() === 'COVERED'
    && (isAbsent || role === 'TARGET')
  ) {
    return true;
  }
  return false;
}
