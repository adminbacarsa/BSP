import { buildCoverageCandidates, type CoverageCandidateRow } from '@cosp/ops-core';
import { buildOpsCandidateInput } from '@/lib/operaciones/coverageCandidateView';

function rowsFor(
  processedData: any[],
  absenceShift: any,
  now: Date,
  crossSessionBusy: Set<string>,
  type: 'EXTEND' | 'ADVANCE',
): any[] {
  const input = buildOpsCandidateInput({
    absenceShift,
    processedData,
    now,
    sessionBusy: [...crossSessionBusy],
  });
  const set = buildCoverageCandidates(input);
  const byId = new Map((processedData || []).map((sh: any) => [String(sh.id), sh]));
  return set.byType[type]
    .filter((r: CoverageCandidateRow) => r.eligible)
    .map((r) => ({
      ...(byId.get(r.sourceShiftId) || {}),
      id: r.sourceShiftId,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      otherPosition: r.otherPosition,
    }));
}

/** EXT: presente, no completado, turno que termina cuando empieza la vacante (±30 min). */
export function listOpsExtCandidatesForVacancy(
  processedData: any[],
  absenceShift: any,
  now: Date,
  crossSessionBusy: Set<string>,
): any[] {
  return rowsFor(processedData, absenceShift, now, crossSessionBusy, 'EXTEND');
}

/** ADV: turno siguiente, inicio contiguo al fin de la vacante (±30 min). */
export function listOpsAdvCandidatesForVacancy(
  processedData: any[],
  absenceShift: any,
  now: Date,
  crossSessionBusy: Set<string>,
): any[] {
  return rowsFor(processedData, absenceShift, now, crossSessionBusy, 'ADVANCE');
}
