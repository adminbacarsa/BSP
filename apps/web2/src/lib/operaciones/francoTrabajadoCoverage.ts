/**
 * Campos comunes al materializar FT como cobertura del hueco (alineado a cascada Auto/Demo).
 * La UI sigue mostrando FT vía isFrancoTrabajado; code = banda del hueco para ACTIVO/cobertura.
 */
export function buildFrancoTrabajadoCoverageFields(absenceShift: {
  objectiveId?: string | null;
  objectiveName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  positionName?: string | null;
  code?: string | null;
  type?: string | null;
}): Record<string, unknown> {
  const band = String(absenceShift.code || absenceShift.type || 'M').toUpperCase();
  const pos = String(absenceShift.positionName || '').trim() || null;
  return {
    isFranco: false,
    isFrancoTrabajado: true,
    code: band,
    type: 'EXTRA_FRANCO',
    objectiveId: absenceShift.objectiveId || null,
    objectiveName: absenceShift.objectiveName || null,
    clientId: absenceShift.clientId || null,
    clientName: absenceShift.clientName || null,
    positionName: pos,
    coversPositionName: pos,
    coversBandCode: band,
    coverageStatus: 'COVERED',
    coverageMode: 'FRANCO_TRABAJADO',
    origin: 'OPERATIONS_COVERAGE',
    francoObjectiveId: absenceShift.objectiveId || null,
    francoObjectiveName: absenceShift.objectiveName || null,
  };
}
