import type { Absence } from '@/services/absenceService';
import {
  coberturaEstadoFromTitularShift,
  type CoberturaRrhhEstado,
} from '@/lib/cosp/coverageSemantics';
import { formatCoveringEmployeeLabel } from '@/lib/operaciones/syncAusenciaCobertura';

export type TitularShiftSnapshot = Record<string, unknown> | null | undefined;

/**
 * Alinea ausencia RRHH con el turno titular (`shiftId`) — misma semántica que Plan/Ops.
 */
export function alignAbsenceWithTitularShift(
  absence: Absence,
  titularShift: TitularShiftSnapshot,
): Absence {
  if (!titularShift) return absence;

  const fromShift = coberturaEstadoFromTitularShift(titularShift);
  const coverName =
    formatCoveringEmployeeLabel(titularShift)
    || String(titularShift.coveredByEmployeeName || titularShift.coveredBy || '').trim()
    || undefined;
  const coverId = String(titularShift.coveredByEmployeeId || '').trim() || undefined;
  const coverageType =
    String(titularShift.coverageType || (absence as Absence & { coverageType?: string }).coverageType || '').trim()
    || undefined;

  let coberturaEstado: CoberturaRrhhEstado = absence.coberturaEstado || 'PENDIENTE';
  if (fromShift === 'GESTIONADA') {
    coberturaEstado = 'GESTIONADA';
  } else if (fromShift === 'VACANTE') {
    coberturaEstado = 'VACANTE';
  } else if (fromShift === 'PENDIENTE' && absence.coberturaEstado === 'GESTIONADA') {
    coberturaEstado = 'GESTIONADA';
  }

  return {
    ...absence,
    coberturaEstado,
    coveredByEmployeeName: coverName || absence.coveredByEmployeeName,
    coveredByEmployeeId: coverId || absence.coveredByEmployeeId,
    ...(coverageType ? { coverageType } : {}),
  };
}

export function alignAbsencesWithShiftMap(
  absences: Absence[],
  shiftById: Map<string, Record<string, unknown>>,
): Absence[] {
  return absences.map((a) => {
    const sid = String((a as Absence & { shiftId?: string }).shiftId || '').trim();
    if (!sid) return a;
    const shift = shiftById.get(sid);
    if (!shift) return a;
    return alignAbsenceWithTitularShift(a, shift);
  });
}
