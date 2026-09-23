import { Timestamp } from 'firebase/firestore';
import {
  applyOperationalGapCloseToChanges,
  type OperationalGapCloseInput,
} from '@/lib/planificacion/operationalGapCoverage';
import type { VacancyPositionSla } from '@/lib/planificacion/vacancySplitBands';
import {
  cospPositionMatches,
  normalizeCospPositionName,
} from '@/lib/cosp/coverageSemantics';

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

const fmtHHmm = (d: unknown): string => {
  const dt = toDate(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
};

export const normOpsPosName = normalizeCospPositionName;

/** @deprecated Alias — usar `cospPositionMatches` desde `@/lib/cosp/coverageSemantics`. */
export const opsPositionMatches = cospPositionMatches;

export function positionStructureFromServices(
  servicesSLA: unknown[],
  objectiveId: string,
): VacancyPositionSla[] {
  const oid = String(objectiveId || '').trim();
  const sla = (servicesSLA as any[]).find((s) => String(s.objectiveId ?? '').trim() === oid);
  const positions = (sla as { positions?: unknown[] })?.positions;
  if (!Array.isArray(positions)) return [];
  return positions.map((p: any) => ({
    positionName: String(p.name ?? p.positionName ?? '').trim(),
    shifts: Array.isArray(p.shifts) ? p.shifts : Array.isArray(p.turnos) ? p.turnos : [],
  }));
}

/** Mapa `${employeeId}_${YYYY-MM-DD}` → fila estilo planificación (con id Firestore). */
export function buildOpsShiftsMap(
  processedData: any[],
  rawShifts: any[] | undefined,
  objectiveId: string,
  dateStr: string,
): { shiftsMap: Record<string, any>; docIdByKey: Map<string, string> } {
  const shiftsMap: Record<string, any> = {};
  const docIdByKey = new Map<string, string>();
  const ingest = (sh: any) => {
    if (!sh?.employeeId || sh.employeeId === 'VACANTE') return;
    if (String(sh.objectiveId ?? '').trim() !== String(objectiveId).trim()) return;
    const d = toDate(sh.shiftDateObj).toLocaleDateString('en-CA');
    if (d !== dateStr) return;
    const key = `${sh.employeeId}_${dateStr}`;
    const row = {
      id: sh.id,
      employeeId: sh.employeeId,
      employeeName: sh.employeeName,
      objectiveId: sh.objectiveId,
      positionName: sh.positionName,
      code: sh.code,
      startTime: typeof sh.startTime === 'string' ? sh.startTime.slice(0, 5) : fmtHHmm(sh.shiftDateObj),
      endTime: typeof sh.endTime === 'string' ? sh.endTime.slice(0, 5) : fmtHHmm(sh.endDateObj),
      hours: sh.hours,
    };
    shiftsMap[key] = row;
    if (sh.id) docIdByKey.set(key, String(sh.id));
  };
  (processedData || []).forEach(ingest);
  (rawShifts || []).forEach(ingest);
  return { shiftsMap, docIdByKey };
}

function coveragePatchFromPlanningChange(
  change: Record<string, unknown>,
  dateStr: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    resolvedBy: 'OPERACIONES',
    isExtended: !!change.isExtended,
    isEarlyStart: !!change.isEarlyStart,
  };
  const copyStr = (k: string) => {
    const v = change[k];
    if (typeof v === 'string' && v.trim()) patch[k] = v.trim();
  };
  [
    'coveragePackageId',
    'coverageType',
    'coverageSegmentRole',
    'coverageNote',
    'coverageStatus',
    'coverageMode',
    'coversEmployeeId',
    'coversPositionName',
    'coversBandCode',
    'segmentFromTime',
    'segmentToTime',
    'coveredBy',
    'comments',
  ].forEach(copyStr);
  if (change.extExtraHours != null && Number.isFinite(Number(change.extExtraHours))) {
    patch.extExtraHours = Number(change.extExtraHours);
  }
  if (typeof change.adjustedEndTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedEndTime)) {
    patch.adjustedEndTime = change.adjustedEndTime;
    patch.extensionEndTime = change.adjustedEndTime;
  }
  if (change.isEarlyStart && typeof change.adjustedStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedStartTime)) {
    const [ah, am] = change.adjustedStartTime.split(':').map(Number);
    const [y, m, d] = dateStr.split('-').map(Number);
    const adj = new Date(y, m - 1, d);
    adj.setHours(ah || 0, am || 0, 0, 0);
    patch.adjustedStartTime = Timestamp.fromDate(adj);
  }
  if (change.isExtended && !patch.isRetention) {
    patch.isRetention = true;
  }
  return patch;
}

export type OpsDualCoverageInput = {
  absenceShift: any;
  extEmpId: string;
  advEmpId: string;
  processedData: any[];
  rawShifts?: any[];
  employees: any[];
  servicesSLA: any[];
};

/**
 * Calcula parches Firestore para EXT+ADV (mismo motor que Planificación / cierre SLA dual).
 */
export function buildOpsDualCoverageTurnoPatches(input: OpsDualCoverageInput): {
  patchesByDocId: Map<string, Record<string, unknown>>;
  coveredByLabel: string;
} {
  const absence = input.absenceShift;
  const dateStr = toDate(absence.shiftDateObj).toLocaleDateString('en-CA');
  const positionStructure = positionStructureFromServices(
    input.servicesSLA,
    absence.objectiveId,
  );
  const { shiftsMap, docIdByKey } = buildOpsShiftsMap(
    input.processedData,
    input.rawShifts,
    absence.objectiveId,
    dateStr,
  );
  const extShift = (input.processedData || []).find(
    (s) => String(s.employeeId) === String(input.extEmpId),
  );
  const advShift = (input.processedData || []).find(
    (s) => String(s.employeeId) === String(input.advEmpId),
  );
  const employeesById: Record<string, any> = {};
  (input.employees || []).forEach((e) => {
    if (e?.id) employeesById[e.id] = e;
  });

  const gapInput: OperationalGapCloseInput = {
    objectiveId: absence.objectiveId,
    clientId: absence.clientId,
    dateStr,
    gapPosition: absence.positionName,
    gapBand: String(absence.code || 'T').toUpperCase(),
    extEmpId: input.extEmpId,
    secondEmpId: input.advEmpId,
    extHomePosition: extShift?.positionName,
    extBaseCode: extShift?.code,
    secondBaseCode: advShift?.code,
    extExtraHours: null,
    secondExtExtraHours: null,
    positionStructure,
    authorizeFrancoTrabajado: true,
    extApplyDateStr: extShift
      ? toDate(extShift.shiftDateObj).toLocaleDateString('en-CA')
      : dateStr,
  };

  const changes = applyOperationalGapCloseToChanges({}, gapInput, {
    shiftsMap,
    employeesById,
  });

  const patchesByDocId = new Map<string, Record<string, unknown>>();
  for (const [key, change] of Object.entries(changes)) {
    if (!change || change.isDeleted) continue;
    const docId = String(change.id || docIdByKey.get(key) || '').trim();
    if (!docId) continue;
    const applyDate = key.endsWith(`_${dateStr}`)
      ? dateStr
      : key.slice(key.indexOf('_') + 1);
    patchesByDocId.set(docId, coveragePatchFromPlanningChange(change, applyDate));
  }

  const extName = (extShift?.employeeName || employeesById[input.extEmpId]?.fullName || 'EXT').split(' ')[0];
  const advName = (advShift?.employeeName || employeesById[input.advEmpId]?.fullName || 'ADV').split(' ')[0];
  const hiStart = fmtHHmm(absence.shiftDateObj);
  const hiEnd = fmtHHmm(absence.endDateObj);
  const advStart = fmtHHmm(advShift?.shiftDateObj);
  const coveredByLabel = `${extName} ext ${hiStart}–${hiEnd} + ${advName} adel ${advStart}–${hiEnd}`;

  return { patchesByDocId, coveredByLabel };
}
