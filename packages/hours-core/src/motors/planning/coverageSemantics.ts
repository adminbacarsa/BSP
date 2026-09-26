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
