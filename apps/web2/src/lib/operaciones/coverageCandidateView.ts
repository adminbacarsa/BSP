import {
  buildCoverageCandidates,
  COVERAGE_HARD_CAP_MS,
  COVERAGE_LICENSE_CODES,
  type BuildCoverageCandidatesInput,
  type CoverageAbsenceView,
  type CoverageCandidateRow,
  type CoverageCandidateSet,
  type CoverageEmployeeView,
  type CoverageShiftView,
} from '@cosp/ops-core';
import { objectiveKnowledgeForEmployee } from '@/lib/operaciones/coverageObjectiveKnowledge';
import type { InternalCoverageCandidate, InternalCoverageKind } from '@/lib/operaciones/coverageInternalCandidates';

export function coverageMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null) {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1, 3, 0, 0, 0);
  }
  const n = new Date(value as string | number).getTime();
  return Number.isFinite(n) ? n : 0;
}

function licenseCodeOf(data: Record<string, unknown>): string {
  for (const c of [data.absenceType, data.shiftCode, data.code, data.tipo, data.type]) {
    const n = String(c || '').trim().toUpperCase();
    if (COVERAGE_LICENSE_CODES.has(n)) return n;
  }
  const label = String(data.type || data.tipoNovedad || '').trim().toUpperCase();
  if (label.includes('VACAC')) return 'V';
  if (label.includes('ENFER')) return 'E';
  if (label.includes('ART')) return 'ART';
  if (label.includes('GREMI')) return 'PG';
  if (label.includes('SUSP')) return 'SUS';
  if (label.includes('LICENC')) return 'L';
  return '';
}

function mapShift(sh: Record<string, unknown>): CoverageShiftView | null {
  const id = String(sh.id || '').trim();
  const employeeId = String(sh.employeeId || '').trim();
  if (!id || !employeeId) return null;
  const startMs = coverageMs(sh.shiftDateObj ?? sh.startTime);
  const endMs = coverageMs(sh.endDateObj ?? sh.endTime);
  return {
    id,
    employeeId,
    employeeName: String(sh.employeeName || sh.fullName || ''),
    code: String(sh.code || sh.type || ''),
    objectiveId: String(sh.objectiveId || ''),
    positionId: String(sh.positionId || sh.puestoId || ''),
    positionName: String(sh.positionName || ''),
    startMs,
    endMs,
    isPresent: sh.isPresent === true,
    isCompleted: sh.isCompleted === true,
    isAbsent: sh.isAbsent === true,
    isFranco: sh.isFranco === true,
    isUnassigned: sh.isUnassigned === true,
    isVirtual: sh.isVirtual === true,
    draft: sh.draft === true,
    coverageUsed: sh.coverageUsed === true,
    isDeleted: sh.isDeleted === true,
    coverageSuperseded: sh.coverageSuperseded === true,
    origin: String(sh.origin || ''),
    coverageType: String(sh.coverageType || ''),
    coverageHoursOnSource: sh.coverageHoursOnSource === true,
    realStartMs: coverageMs(sh.realStartTime) || undefined,
    checkInMs: coverageMs(sh.checkInTime) || coverageMs(sh.presenciaAt) || undefined,
    deploymentBand: String(sh.deploymentBand || sh.coversBandCode || ''),
    absenceShiftId: String(sh.absenceShiftId || ''),
    isRetention: sh.isRetention === true,
    retentionAbsenceShiftId: String(sh.retentionAbsenceShiftId || ''),
  };
}

function mapAbsence(raw: Record<string, unknown>): CoverageAbsenceView | null {
  const employeeId = String(raw.employeeId || '').trim();
  const code = licenseCodeOf(raw);
  if (!employeeId || !code) return null;
  const startMs = coverageMs(raw.startDate ?? raw.fechaInicio);
  let endMs = coverageMs(raw.endDate ?? raw.fechaFin);
  if (!startMs) return null;
  if (!endMs) endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  else if (typeof raw.endDate === 'string' || typeof raw.fechaFin === 'string') {
    endMs = coverageMs(raw.endDate ?? raw.fechaFin) + 24 * 60 * 60 * 1000 - 1;
  }
  return {
    employeeId,
    startMs,
    endMs,
    code,
    status: String(raw.status || ''),
  };
}

export function buildOpsCandidateInput(args: {
  absenceShift: Record<string, unknown>;
  processedData?: unknown[];
  rawShifts?: unknown[];
  employees?: unknown[];
  absences?: unknown[];
  sessionBusy?: string[];
  now?: Date;
  puntajePorEmpleado?: Record<string, number>;
}): BuildCoverageCandidatesInput {
  const absence = args.absenceShift;
  const startMs = coverageMs(absence.shiftDateObj ?? absence.startTime);
  const endMs = coverageMs(absence.endDateObj ?? absence.endTime);
  const byId = new Map<string, CoverageShiftView>();
  for (const raw of [...(args.processedData || []), ...(args.rawShifts || [])]) {
    const row = mapShift(raw as Record<string, unknown>);
    if (row) byId.set(row.id, row);
  }
  const employees: CoverageEmployeeView[] = (args.employees || []).map((raw) => {
    const e = raw as Record<string, unknown>;
    const name = `${e.lastName || ''} ${e.firstName || ''}`.trim()
      || String(e.fullName || e.name || e.id || '');
    return {
      id: String(e.id || ''),
      name,
      restriccionesObjetivo: (e.restriccionesObjetivo || []) as { objectiveId?: string }[],
      restriccionesCliente: (e.restriccionesCliente || []) as { clientId?: string }[],
      aptitudes: (e.aptitudes || []) as { codigo?: string; vigencia?: string }[],
    };
  });
  return {
    nowMs: (args.now || new Date()).getTime(),
    hardCapMs: COVERAGE_HARD_CAP_MS,
    gap: {
      titularShiftId: String(absence.id || ''),
      absentEmployeeId: String(absence.employeeId || ''),
      objectiveId: String(absence.objectiveId || ''),
      clientId: String(absence.clientId || '') || undefined,
      positionId: String(absence.positionId || absence.puestoId || '') || undefined,
      positionName: String(absence.positionName || '') || undefined,
      startMs,
      endMs,
      band: String(absence.code || '') || undefined,
      aptitudesRequeridas: [],
      alreadyCovered: String(absence.coverageStatus || '').toUpperCase() === 'COVERED',
    },
    shifts: [...byId.values()],
    absences: (args.absences || [])
      .map((a) => mapAbsence(a as Record<string, unknown>))
      .filter((a): a is CoverageAbsenceView => !!a),
    employees,
    sessionBusyEmployeeIds: args.sessionBusy || [],
    purpose: 'select',
    ...(args.puntajePorEmpleado ? { puntajePorEmpleado: args.puntajePorEmpleado } : {}),
  };
}

function toInternal(
  row: CoverageCandidateRow,
  shift: Record<string, unknown> | undefined,
  employees: Record<string, unknown>[],
  objectiveId: string,
  kind: InternalCoverageKind,
): InternalCoverageCandidate {
  const emp = employees.find((e) => String(e.id || '') === row.employeeId);
  const knowledge = objectiveKnowledgeForEmployee(emp, objectiveId);
  return {
    coverageKind: kind,
    id: row.sourceShiftId || row.employeeId,
    employeeId: row.employeeId,
    fullName: row.employeeName,
    phone: String(emp?.phone || emp?.celular || shift?.phone || ''),
    code: String(shift?.code || kind),
    positionName: shift?.positionName ? String(shift.positionName) : undefined,
    objectiveName: shift?.objectiveName ? String(shift.objectiveName) : undefined,
    knowledgeLabel: knowledge.label,
    knowsObjective: knowledge.knowsObjective,
    otherPosition: row.otherPosition,
    shiftRow: shift || {},
  };
}

export type OpsCandidateView = {
  set: CoverageCandidateSet;
  ext: Record<string, unknown>[];
  adv: Record<string, unknown>[];
  ret: InternalCoverageCandidate[];
  ref: InternalCoverageCandidate[];
  esc: InternalCoverageCandidate[];
  ft: Record<string, unknown>[];
  rejected: CoverageCandidateRow[];
};

export function buildOpsCandidateView(args: {
  absenceShift: Record<string, unknown>;
  processedData?: unknown[];
  rawShifts?: unknown[];
  employees?: unknown[];
  absences?: unknown[];
  sessionBusy?: string[];
  now?: Date;
  puntajePorEmpleado?: Record<string, number>;
}): OpsCandidateView {
  const input = buildOpsCandidateInput(args);
  const set = buildCoverageCandidates(input);
  const shifts = [...(args.processedData || []), ...(args.rawShifts || [])] as Record<string, unknown>[];
  const byId = new Map(shifts.filter((s) => s.id).map((s) => [String(s.id), s]));
  const emps = (args.employees || []) as Record<string, unknown>[];
  const objectiveId = String(args.absenceShift.objectiveId || '');
  const decorate = (row: CoverageCandidateRow) => {
    const sh = byId.get(row.sourceShiftId) || {};
    return {
      ...sh,
      id: row.sourceShiftId || sh.id,
      employeeId: row.employeeId,
      employeeName: row.employeeName || sh.employeeName,
      fullName: row.employeeName,
      otherPosition: row.otherPosition,
      positionRank: row.positionRank,
    };
  };
  const mapKind = (rows: CoverageCandidateRow[], kind: InternalCoverageKind) =>
    rows.filter((r) => r.eligible).map((r) => toInternal(r, byId.get(r.sourceShiftId), emps, objectiveId, kind));
  return {
    set,
    ext: set.byType.EXTEND.filter((r) => r.eligible).map(decorate),
    adv: set.byType.ADVANCE.filter((r) => r.eligible).map(decorate),
    ret: mapKind(set.byType.RET, 'RET'),
    ref: mapKind(set.byType.REF, 'REF'),
    esc: mapKind(set.byType.ESC, 'ESC'),
    ft: set.byType.FT.filter((r) => r.eligible).map(decorate),
    rejected: set.rejected,
  };
}
