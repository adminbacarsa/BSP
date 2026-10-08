import { ABSENCE_VALID_CODES } from '@/lib/planificacion/absenceCodes';

const NO_PINTAR = new Set(['LT', 'RA']);

/**
 * Código de la celda cuando el turno está ausente y no hay doc en `ausencias`.
 * `resolvedBy: OPERACIONES` saca al titular del crono planificado; sin el doc la celda quedaba vacía.
 */
export function codigoGrillaAusenteSinRegistro(shift: {
  isDeleted?: boolean;
  isAbsent?: boolean;
  status?: unknown;
  origin?: unknown;
  absenceType?: unknown;
  code?: unknown;
} | null | undefined): string | null {
  if (!shift || shift.isDeleted === true) return null;
  const absent = shift.isAbsent === true || String(shift.status || '').toUpperCase() === 'ABSENT';
  if (!absent) return null;
  const origin = String(shift.origin || '').toUpperCase();
  if (origin === 'OPERATIONS_COVERAGE' || origin === 'RETEN' || origin === 'SLA_VIRTUAL') return null;
  const type = String(shift.absenceType || '').trim().toUpperCase();
  if (type === 'ART') return 'ART';
  if (NO_PINTAR.has(type)) return null;
  if (ABSENCE_VALID_CODES.has(type)) return type;
  return 'AA';
}

export function turnoDelCronoEnPantalla(
  shift: { objectiveId?: unknown } | null | undefined,
  objectiveId: string | null | undefined,
  grupoIds: string[] | null | undefined,
): boolean {
  if (!shift) return false;
  const obj = String(shift.objectiveId || '');
  if (!obj) return false;
  if (grupoIds && grupoIds.length) return grupoIds.includes(obj);
  return !!objectiveId && obj === String(objectiveId);
}
