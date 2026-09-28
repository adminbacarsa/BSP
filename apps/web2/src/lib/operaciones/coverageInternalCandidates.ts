import { buildOpsCandidateView } from '@/lib/operaciones/coverageCandidateView';

export type InternalCoverageKind = 'RET' | 'REF' | 'ESC';

export type InternalCoverageCandidate = {
  coverageKind: InternalCoverageKind;
  id: string;
  employeeId: string;
  fullName: string;
  phone: string;
  code: string;
  positionName?: string;
  objectiveName?: string;
  knowledgeLabel: string;
  knowsObjective: boolean;
  otherPosition?: boolean;
  shiftRow: Record<string, unknown>;
};

export type InternalCoverageGroups = {
  ret: InternalCoverageCandidate[];
  ref: InternalCoverageCandidate[];
  esc: InternalCoverageCandidate[];
  all: InternalCoverageCandidate[];
};

export function buildInternalCoverageCandidates(
  processedData: unknown[],
  employees: unknown[],
  absenceShift: Record<string, unknown>,
  now: Date,
  crossSessionBusy: Set<string>,
): InternalCoverageGroups {
  const view = buildOpsCandidateView({
    absenceShift,
    processedData,
    employees,
    now,
    sessionBusy: [...crossSessionBusy],
  });
  const byKnowledge = (a: InternalCoverageCandidate, b: InternalCoverageCandidate) =>
    (b.knowsObjective ? 1 : 0) - (a.knowsObjective ? 1 : 0);
  const ret = [...view.ret].sort(byKnowledge);
  const ref = [...view.ref].sort(byKnowledge);
  const esc = [...view.esc].sort(byKnowledge);
  return { ret, ref, esc, all: [...ret, ...ref, ...esc] };
}
