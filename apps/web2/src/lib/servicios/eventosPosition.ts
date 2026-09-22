import type { ServicePosition } from '@/services/slaService';

/** Puesto de extras (eventos, extras cliente): no cubre SLA, no vende horas de contrato. */
export const EVENTOS_COVERAGE_TYPE = 'eventos';
export const EVENTOS_SHIFT_CODE = 'EVT';

export function isEventosCoverageType(coverageType?: string | null): boolean {
  return String(coverageType || '').toLowerCase().trim() === EVENTOS_COVERAGE_TYPE;
}

export function isEventosPosition(pos: { coverageType?: string; code?: string; name?: string } | null | undefined): boolean {
  if (!pos) return false;
  if (isEventosCoverageType(pos.coverageType)) return true;
  return String(pos.code || '').toUpperCase() === EVENTOS_SHIFT_CODE;
}

export function listEventosPositions(positions: Array<{ id?: string; name?: string; coverageType?: string; code?: string }> | undefined | null) {
  return (positions || []).filter(isEventosPosition);
}

export function buildEventosPositionDraft(partial?: Partial<ServicePosition>): ServicePosition {
  const base: ServicePosition = {
    id: '',
    name: 'Eventos',
    code: EVENTOS_SHIFT_CODE,
    coverageType: EVENTOS_COVERAGE_TYPE,
    quantity: 1,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [],
    preferenciaGenero: 'INDISTINTO',
    includeInSlaTotals: false,
  };
  return {
    ...base,
    ...partial,
    coverageType: EVENTOS_COVERAGE_TYPE,
    includeInSlaTotals: false,
    allowedShiftTypes: partial?.allowedShiftTypes ?? [],
  };
}
