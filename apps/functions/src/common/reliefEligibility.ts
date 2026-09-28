import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';

/**
 * Espejo de `packages/ops-core/src/reliefEligibility.ts`.
 *
 * Turnos extra del puesto (CCT COSP). Nunca relevan al saliente ni generan hueco
 * de SLA: son sobreturnos sobre una franja que ya está vendida y cubierta.
 * Solo pasan a relevar si una convocatoria los convirtió en cobertura
 * (`ops_cov` con `origin: OPERATIONS_COVERAGE`, que sí toma la franja del titular).
 */
export const NON_RELIEF_EXTRA_CODES: ReadonlySet<string> = new Set(['ESC', 'REF', 'RET']);

const RELIEF_LICENSE_CODES: ReadonlySet<string> = new Set([
  'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS',
]);

const RELIEF_FRANCO_CODES: ReadonlySet<string> = new Set(['F', 'FF', 'FP']);

export type ReliefIneligibleReason =
  | 'SIN_TURNO'
  | 'DRAFT'
  | 'VIRTUAL'
  | 'OPS_COV_TRACE'
  | 'LICENCIA'
  | 'FRANCO'
  | 'EXTRA_NO_RELEVA';

function normCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function reliefShiftCode(shift: Record<string, unknown> | null | undefined): string {
  if (!shift) return '';
  return normCode(shift.code) || normCode(shift.type) || normCode(shift.shiftCode);
}

// Copia local (evita ciclo con syncAusenciaCobertura, que importa media cobertura).
function isActiveCoverageDoc(shift: Record<string, unknown>): boolean {
  if (String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (shift.coverageSuperseded === true) return false;
  if (String(shift.status || '').toUpperCase() === 'CANCELLED') return false;
  if (shift.isDeleted === true) return false;
  return true;
}

export function reliefIneligibleReason(
  shift: Record<string, unknown> | null | undefined,
): ReliefIneligibleReason | null {
  if (!shift) return 'SIN_TURNO';
  if (shift.draft === true) return 'DRAFT';
  if (shift.isVirtual === true) return 'VIRTUAL';
  if (isOpsCoverageHoursOnSourceDoc(shift)) return 'OPS_COV_TRACE';

  const code = reliefShiftCode(shift);
  if (RELIEF_LICENSE_CODES.has(code)) return 'LICENCIA';
  if (shift.isFranco === true || RELIEF_FRANCO_CODES.has(code)) return 'FRANCO';
  if (NON_RELIEF_EXTRA_CODES.has(code) && !isActiveCoverageDoc(shift)) return 'EXTRA_NO_RELEVA';

  return null;
}

/** El turno puede tomar/soltar la franja del puesto (titular base u ops_cov de cobertura). */
export function isReliefEligibleShift(
  shift: Record<string, unknown> | null | undefined,
): boolean {
  return reliefIneligibleReason(shift) === null;
}

/** Turno extra (ESC/REF/RET planificado) que nunca releva ni deja hueco de SLA. */
export function isExtraNonReliefShift(
  shift: Record<string, unknown> | null | undefined,
): boolean {
  return reliefIneligibleReason(shift) === 'EXTRA_NO_RELEVA';
}
