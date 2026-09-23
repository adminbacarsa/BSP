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

/** Excluir de detectarAusencias, trigger ausencia, vacantes, auto-completar y retención por hueco. */
export function skipAbsencePipelineForShift(data: Record<string, unknown> | null | undefined): boolean {
  return isOpsCoverageHoursOnSourceDoc(data);
}
