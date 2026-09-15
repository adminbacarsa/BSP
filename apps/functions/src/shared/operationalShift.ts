/** Criterio único de origen operativo (mirror de shared-domain para el runtime Cloud Build). */
export const OPERATIONAL_SHIFT_ORIGINS = new Set([
  'RETEN',
  'OPERATIONS_COVERAGE',
  'SLA_VIRTUAL',
]);

export type OperationalShiftLike = {
  origin?: unknown;
  isReten?: unknown;
  resolvedBy?: unknown;
} | null | undefined;

export function isOperationalOriginShift(shift: OperationalShiftLike): boolean {
  if (!shift) return false;
  const origin = String(shift.origin || '').trim().toUpperCase();
  return OPERATIONAL_SHIFT_ORIGINS.has(origin)
    || shift.isReten === true
    || String(shift.resolvedBy || '').trim().toUpperCase() === 'OPERACIONES';
}
