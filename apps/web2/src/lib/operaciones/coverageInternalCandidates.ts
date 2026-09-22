import { objectiveKnowledgeForEmployee } from '@/lib/operaciones/coverageObjectiveKnowledge';

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
  shiftRow: Record<string, unknown>;
};

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

const isSameDay = (d1: unknown, d2: Date) =>
  toDate(d1).toLocaleDateString('en-CA') === d2.toLocaleDateString('en-CA');

const normBandCode = (c: unknown) => String(c || '').trim().toUpperCase();

const dedupeShiftsByEmployee = (rows: Record<string, unknown>[]): Record<string, unknown>[] => {
  const byEmp = new Map<string, Record<string, unknown>>();
  for (const sh of rows) {
    const eid = String(sh.employeeId || '').trim();
    if (!eid) continue;
    const prev = byEmp.get(eid);
    if (!prev) {
      byEmp.set(eid, sh);
      continue;
    }
    const prefer = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      if (a.isPresent && !a.isCompleted && !(b.isPresent && !b.isCompleted)) return a;
      if (b.isPresent && !b.isCompleted && !(a.isPresent && !a.isCompleted)) return b;
      return a;
    };
    byEmp.set(eid, prefer(prev, sh));
  }
  return [...byEmp.values()];
};

const escRefBandMatchesVacancy = (
  escShift: Record<string, unknown>,
  vacancyCode: string,
  now: Date,
): boolean => {
  if (escShift.isPresent && !escShift.isCompleted) return true;
  const vac = normBandCode(vacancyCode);
  const escBand = normBandCode(escShift.deploymentBand || escShift.coversBandCode || '');
  if (vac && escBand && vac === escBand) return true;
  const end = toDate(escShift.endDateObj);
  if (end.getTime() <= now.getTime() && vac && escBand && vac === escBand) return true;
  return false;
};

function mapRow(
  sh: Record<string, unknown>,
  kind: InternalCoverageKind,
  employees: Record<string, unknown>[],
  objectiveId: string,
): InternalCoverageCandidate {
  const employeeId = String(sh.employeeId || '').trim();
  const emp = employees.find((e) => String(e.id || '') === employeeId);
  const knowledge = objectiveKnowledgeForEmployee(emp, objectiveId);
  const fullName =
    String(sh.employeeName || '').trim()
    || (emp
      ? `${String(emp.firstName || '')} ${String(emp.lastName || '')}`.trim()
      : '')
    || employeeId;
  return {
    coverageKind: kind,
    id: String(sh.id || employeeId),
    employeeId,
    fullName,
    phone: String(emp?.phone || emp?.celular || sh.phone || ''),
    code: normBandCode(sh.code),
    positionName: sh.positionName ? String(sh.positionName) : undefined,
    objectiveName: sh.objectiveName ? String(sh.objectiveName) : undefined,
    knowledgeLabel: knowledge.label,
    knowsObjective: knowledge.knowsObjective,
    shiftRow: sh,
  };
}

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
  const objectiveId = String(absenceShift.objectiveId || '').trim();
  const absentEmpId = String(absenceShift.employeeId || '').trim();
  const bandCode = String(absenceShift.code || '');
  const emps = (employees || []) as Record<string, unknown>[];

  const baseFilter = (sh: Record<string, unknown>) => {
    if (!isSameDay(sh.shiftDateObj, now)) return false;
    if (sh.isAbsent) return false;
    if (String(sh.employeeId || '').trim() === absentEmpId) return false;
    if (crossSessionBusy.has(String(sh.employeeId || ''))) return false;
    if (sh.isVirtual === true) return false;
    if (objectiveId && String(sh.objectiveId || '').trim() !== objectiveId) return false;
    return true;
  };

  const retRows = dedupeShiftsByEmployee(
    (processedData || [])
      .filter((raw) => {
        const sh = raw as Record<string, unknown>;
        if (!baseFilter(sh)) return false;
        return normBandCode(sh.code) === 'RET';
      }) as Record<string, unknown>[],
  );

  const refRows = dedupeShiftsByEmployee(
    (processedData || [])
      .filter((raw) => {
        const sh = raw as Record<string, unknown>;
        if (!baseFilter(sh)) return false;
        if (normBandCode(sh.code) !== 'REF') return false;
        return escRefBandMatchesVacancy(sh, bandCode, now);
      }) as Record<string, unknown>[],
  );

  const escRows = dedupeShiftsByEmployee(
    (processedData || [])
      .filter((raw) => {
        const sh = raw as Record<string, unknown>;
        if (!baseFilter(sh)) return false;
        if (normBandCode(sh.code) !== 'ESC') return false;
        return escRefBandMatchesVacancy(sh, bandCode, now);
      }) as Record<string, unknown>[],
  );

  const ret = retRows.map((sh) => mapRow(sh, 'RET', emps, objectiveId));
  const ref = refRows.map((sh) => mapRow(sh, 'REF', emps, objectiveId));
  const esc = escRows.map((sh) => mapRow(sh, 'ESC', emps, objectiveId));

  ret.sort((a, b) => (b.knowsObjective ? 1 : 0) - (a.knowsObjective ? 1 : 0));
  ref.sort((a, b) => (b.knowsObjective ? 1 : 0) - (a.knowsObjective ? 1 : 0));
  esc.sort((a, b) => (b.knowsObjective ? 1 : 0) - (a.knowsObjective ? 1 : 0));

  return {
    ret,
    ref,
    esc,
    all: [...ret, ...ref, ...esc],
  };
}
