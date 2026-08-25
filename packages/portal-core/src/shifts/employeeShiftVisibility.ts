import { toDate } from '../utils/dates';

export type EmployeeShiftVisibilityInput = {
  draft?: boolean | null;
  origin?: string | null;
  code?: string | null;
  isReten?: boolean | null;
  resolvedBy?: string | null;
  isPresent?: boolean | null;
  isCompleted?: boolean | null;
  isAbsent?: boolean | null;
  status?: string | null;
  objectiveId?: string | null;
  startTime?: unknown;
  eventoId?: string | null;
};

/** Orígenes / códigos que el vigilador debe ver aunque el mes no esté publicado. */
export function isOperationalPortalShift(shift: EmployeeShiftVisibilityInput): boolean {
  const origin = String(shift.origin || '')
    .trim()
    .toUpperCase();
  if (
    origin === 'RETEN' ||
    origin === 'OPERATIONS_COVERAGE' ||
    origin === 'CLIENT_REQUEST' ||
    origin === 'EVENTO'
  ) {
    return true;
  }
  if (shift.isReten === true) return true;
  if (String(shift.resolvedBy || '').toUpperCase() === 'OPERACIONES') return true;
  const code = String(shift.code || '')
    .trim()
    .toUpperCase();
  if (code === 'EV' || shift.eventoId) return true;
  return false;
}

export function planificacionMonthLookupKey(
  objectiveId: string,
  year: number,
  month: number,
): string {
  return `${String(objectiveId).trim()}_${year}_${month}`;
}

export function shiftPlanificacionLookupKey(
  shift: EmployeeShiftVisibilityInput,
): string | null {
  const objectiveId = String(shift.objectiveId || '').trim();
  const start = toDate(shift.startTime as never);
  if (!objectiveId || !start) return null;
  return planificacionMonthLookupKey(
    objectiveId,
    start.getFullYear(),
    start.getMonth() + 1,
  );
}

/**
 * Visibilidad en portal guardia / app nativa.
 * - draft:true → nunca (borrador de planificación)
 * - operativos / EV → siempre
 * - resto → solo si el objetivo/mes está en publishedKeys
 *
 * Si `publishedKeys` es null (aún cargando), se ocultan los de planificación
 * para no filtrar turnos no publicados.
 */
export function isShiftVisibleToEmployee(
  shift: EmployeeShiftVisibilityInput,
  publishedKeys: Set<string> | null,
): boolean {
  // EV / operativos: visibles aunque el mes esté en borrador (no dependen del crono).
  if (isOperationalPortalShift(shift)) return true;

  if (shift.draft === true) return false;

  const status = String(shift.status || '').toUpperCase();
  if (
    shift.isPresent === true ||
    shift.isCompleted === true ||
    status === 'PRESENT' ||
    status === 'COMPLETED'
  ) {
    return true;
  }

  const key = shiftPlanificacionLookupKey(shift);
  if (!key) return false;
  if (publishedKeys == null) return false;
  return publishedKeys.has(key);
}
