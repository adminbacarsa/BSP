/**
 * Agrupa turnos por coverageEventId y arma la cadena titular → vacante → cubridor.
 */
export type CoverageChainRole = 'titular' | 'vacancy' | 'coverer' | 'other';

export type CoverageChainNode = {
  id: string;
  role: CoverageChainRole;
  employeeName: string;
  employeeId: string | null;
  code: string;
  objectiveName: string;
  positionName: string;
  origin: string;
  coverageType: string | null;
  status: string;
  isAbsent: boolean;
};

export type CoverageChain = {
  coverageEventId: string;
  coverageType: string | null;
  resolvedBy: string | null;
  objectiveId: string | null;
  objectiveName: string;
  clientId: string | null;
  clientName: string;
  titularName: string;
  covererName: string;
  nodes: CoverageChainNode[];
  incomplete: boolean;
  missingRoles: CoverageChainRole[];
  scheduleDate: string;
};

export type OrphanCoverageHint = {
  id: string;
  kind: 'titular_sin_event' | 'coverer_sin_event' | 'vacancy_sin_event';
  employeeName: string;
  objectiveName: string;
  code: string;
  hint: string;
};

const isVirtualShiftId = (id: unknown): boolean => {
  const s = String(id || '');
  return !s || s.startsWith('V124_') || s.startsWith('SLA_GAP');
};

export function isVacancyLike(s: any): boolean {
  if (!s) return false;
  const origin = String(s.origin || '').toUpperCase();
  return (
    s.isUnassigned === true
    || s.employeeId === 'VACANTE'
    || String(s.employeeName || '').toUpperCase().startsWith('VACANTE')
    || origin.startsWith('VACANTE_')
    || origin === 'INTERRUPTION'
  );
}

export function classifyShiftRole(s: any): CoverageChainRole {
  if (isVacancyLike(s)) return 'vacancy';
  if (
    s.coversEmployeeId
    || s.coversAbsenceEmployeeName
    || (s.origin === 'OPERATIONS_COVERAGE' && (s.causedByShiftId || s.coversEmployeeId))
    || s.isRetentionActivated === true
    || s.isFrancoTrabajado === true
    || s.isExtended === true
    || s.isAdvanced === true
  ) {
    return 'coverer';
  }
  if (
    s.isAbsent === true
    || s.coveredByEmployeeId
    || s.coveredByEmployeeName
    || s.operacionallyCovered === true
    || String(s.status || '').toUpperCase() === 'ABSENT'
  ) {
    return 'titular';
  }
  return 'other';
}

function toNode(s: any): CoverageChainNode {
  const role = classifyShiftRole(s);
  return {
    id: String(s.id),
    role,
    employeeName: String(s.employeeName || (role === 'vacancy' ? 'VACANTE' : '—')),
    employeeId: s.employeeId && s.employeeId !== 'VACANTE' ? String(s.employeeId) : null,
    code: String(s.code || s.type || '—').toUpperCase(),
    objectiveName: String(s.objectiveName || '—'),
    positionName: String(s.positionName || ''),
    origin: String(s.origin || '—'),
    coverageType: s.coverageType ? String(s.coverageType) : null,
    status: String(s.status || '—'),
    isAbsent: s.isAbsent === true,
  };
}

export function buildCoverageChains(shifts: any[]): CoverageChain[] {
  const byEvent = new Map<string, any[]>();
  for (const s of shifts) {
    const eid = String(s.coverageEventId || '').trim();
    if (!eid) continue;
    if (!byEvent.has(eid)) byEvent.set(eid, []);
    byEvent.get(eid)!.push(s);
  }

  const chains: CoverageChain[] = [];
  for (const [coverageEventId, docs] of byEvent) {
    const nodes = docs.map(toNode);
    const roleOrder: CoverageChainRole[] = ['titular', 'vacancy', 'coverer', 'other'];
    nodes.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));

    const has = (r: CoverageChainRole) => nodes.some((n) => n.role === r);
    const missingRoles: CoverageChainRole[] = (['titular', 'vacancy', 'coverer'] as CoverageChainRole[])
      .filter((r) => !has(r));

    const titular = nodes.find((n) => n.role === 'titular');
    const coverer = nodes.find((n) => n.role === 'coverer');
    const sample = docs[0] || {};

    chains.push({
      coverageEventId,
      coverageType: String(sample.coverageType || coverer?.coverageType || titular?.coverageType || '') || null,
      resolvedBy: sample.resolvedBy ? String(sample.resolvedBy) : null,
      objectiveId: sample.objectiveId ? String(sample.objectiveId) : null,
      objectiveName: String(sample.objectiveName || titular?.objectiveName || coverer?.objectiveName || '—'),
      clientId: sample.clientId ? String(sample.clientId) : null,
      clientName: String(sample.clientName || ''),
      titularName:
        String(sample.coversAbsenceEmployeeName || '')
        || titular?.employeeName
        || String(sample.causedByEmployeeName || '')
        || '—',
      covererName:
        String(sample.coveredByEmployeeName || '')
        || coverer?.employeeName
        || '—',
      nodes,
      incomplete: missingRoles.length > 0,
      missingRoles,
      scheduleDate: String(sample.scheduleDate || ''),
    });
  }

  chains.sort((a, b) => a.objectiveName.localeCompare(b.objectiveName, 'es'));
  return chains;
}

/** Candidatos a backfill: señales de cobertura sin coverageEventId. */
export function findOrphanCoverageHints(shifts: any[]): OrphanCoverageHint[] {
  const out: OrphanCoverageHint[] = [];
  for (const s of shifts) {
    if (String(s.coverageEventId || '').trim()) continue;
    if (isVirtualShiftId(s.id)) continue;

    if (isVacancyLike(s) && (s.coveredByEmployeeId || s.coveredByEmployeeName || s.status === 'COVERED')) {
      out.push({
        id: s.id,
        kind: 'vacancy_sin_event',
        employeeName: String(s.employeeName || 'VACANTE'),
        objectiveName: String(s.objectiveName || '—'),
        code: String(s.code || '—'),
        hint: s.causedByShiftId
          ? `Vacante cubierta · causedBy=${s.causedByShiftId}`
          : 'Vacante COVERED sin causedByShiftId',
      });
      continue;
    }

    if (
      !isVacancyLike(s)
      && (s.coversEmployeeId || s.coversAbsenceEmployeeName)
      && s.employeeId !== 'VACANTE'
    ) {
      out.push({
        id: s.id,
        kind: 'coverer_sin_event',
        employeeName: String(s.employeeName || '—'),
        objectiveName: String(s.objectiveName || '—'),
        code: String(s.code || '—'),
        hint: s.coversAbsenceEmployeeName
          ? `Cubre a ${s.coversAbsenceEmployeeName}`
          : `coversEmployeeId=${s.coversEmployeeId}`,
      });
      continue;
    }

    if (
      !isVacancyLike(s)
      && (s.isAbsent === true || String(s.status || '').toUpperCase() === 'ABSENT')
      && (s.coveredByEmployeeId || s.coveredByEmployeeName)
    ) {
      out.push({
        id: s.id,
        kind: 'titular_sin_event',
        employeeName: String(s.employeeName || '—'),
        objectiveName: String(s.objectiveName || '—'),
        code: String(s.code || '—'),
        hint: `Ausente cubierto por ${s.coveredByEmployeeName || s.coveredByEmployeeId}`,
      });
    }
  }
  return out;
}

export function planningDeepLink(opts: {
  objectiveId?: string | null;
  clientId?: string | null;
  dateStr: string;
}): string {
  const [y, m] = opts.dateStr.split('-').map(Number);
  const params = new URLSearchParams();
  if (opts.objectiveId) params.set('objectiveId', opts.objectiveId);
  if (opts.clientId) params.set('clientId', opts.clientId);
  if (y && m) {
    params.set('year', String(y));
    params.set('month', String(m));
  }
  const q = params.toString();
  return q ? `/admin/planificacion/?${q}` : '/admin/planificacion/';
}
