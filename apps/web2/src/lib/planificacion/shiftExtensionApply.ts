/**
 * Extensión de jornada de un guardia (desde celda), con o sin cierre SLA dual.
 */

import { resolveEmployeeShift } from './planningRecompositionApply';
import { applyOperationalGapCloseToChanges, type OperationalGapCloseInput } from './operationalGapCoverage';
import { shiftTimeWindowFromSla, type VacancyPositionSla } from './vacancySplitBands';
import { normalizePlanningPositionName } from './positionCoverageUnits';

const NON_WORK = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET', 'REF', 'ESC', 'PAST', 'LOCKED']);

function parseMin(raw: string | undefined | null): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToHHmm(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const mm = t % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function slaEndForShift(
  shift: Record<string, any> | null | undefined,
  positionStructure: VacancyPositionSla[] | undefined,
): string {
  if (!shift) return '18:00';
  if (typeof shift.endTime === 'string' && shift.endTime) return shift.endTime.slice(0, 5);
  const posName = String(shift.positionName || '');
  const code = String(shift.code || '').toUpperCase();
  const pos = positionStructure?.find((p) => p.positionName === posName);
  const band = pos?.shifts?.find((s) => String(s.code).toUpperCase() === code);
  if (band) return shiftTimeWindowFromSla(band).to;
  return '18:00';
}

export function endTimeAfterExtraHours(slaEnd: string, extraHours: number): string {
  const endMin = parseMin(slaEnd);
  if (endMin == null) return slaEnd;
  return minutesToHHmm(endMin + Math.round(extraHours * 60));
}

export type SingleShiftExtensionInput = {
  objectiveId: string;
  empId: string;
  dateStr: string;
  extraHours: number;
  coversBandCode?: string | null;
  coversPositionName?: string | null;
};

export function applySingleShiftExtension(
  baseChanges: Record<string, any>,
  ctx: {
    shiftsMap: Record<string, any>;
    positionStructure?: VacancyPositionSla[];
  },
  input: SingleShiftExtensionInput,
): Record<string, any> {
  const key = `${input.empId}_${input.dateStr}`;
  const pending = baseChanges[key];
  const base = (pending && !pending.isDeleted ? pending : null)
    || ctx.shiftsMap[key]
    || null;
  if (!base || base.isDeleted) {
    throw new Error('El guardia no tiene turno laboral ese día');
  }
  const code = String(base.code || '').toUpperCase();
  if (!code || NON_WORK.has(code)) {
    throw new Error('Solo se puede extender un turno de trabajo');
  }

  const slaEnd = slaEndForShift(base, ctx.positionStructure);
  const segTo = endTimeAfterExtraHours(slaEnd, input.extraHours);
  const segFrom = slaEnd;
  const pkgId = `shift_ext_${input.empId}_${input.dateStr}_${Date.now()}`;

  const next = {
    ...base,
    isTemp: true,
    objectiveId: base.objectiveId || input.objectiveId,
    isExtended: true,
    isEarlyStart: false,
    adjustedEndTime: segTo,
    segmentFromTime: segFrom,
    segmentToTime: segTo,
    coveragePackageId: pkgId,
    coverageType: 'ABSENCE_COVERAGE',
    coverageSegmentRole: 'EXTENSION',
    coverageMode: 'SPLIT',
    coverageStatus: input.coversBandCode ? 'PARTIAL' : undefined,
    coversBandCode: input.coversBandCode || undefined,
    coversPositionName: input.coversPositionName || base.positionName,
    extExtraHours: input.extraHours,
    coverageNote: input.coversBandCode
      ? `Ext +${input.extraHours}h (${segFrom}–${segTo}) · aporte banda ${input.coversBandCode}`
      : `Extensión +${input.extraHours}h (${segFrom}–${segTo})`,
  };

  return { ...baseChanges, [key]: next };
}

function normBand(code: unknown): string {
  return String(code || '').toUpperCase();
}

/** Une dos extensiones sueltas del mismo día/banda/puesto para acreditar SLA (4/4). */
export function synchronizeDualExtensionPackage(
  changes: Record<string, any>,
  dateStr: string,
  empId: string,
  gapBand: string,
  gapPosition: string,
  shiftsMap?: Record<string, any>,
): Record<string, any> {
  const key = `${empId}_${dateStr}`;
  const cur = changes[key];
  if (!cur?.isExtended) return changes;

  const band = normBand(gapBand);
  const posNorm = normalizePlanningPositionName(gapPosition);
  let partnerKey: string | null = null;
  let sharedPkg: string | undefined = cur.coveragePackageId;

  const candidateKeys = new Set<string>(Object.keys(changes));
  if (shiftsMap) {
    for (const k of Object.keys(shiftsMap)) {
      if (k.endsWith(`_${dateStr}`)) candidateKeys.add(k);
    }
  }

  const readShift = (k: string): Record<string, any> | null => {
    const pending = changes[k];
    if (pending?.isDeleted) return null;
    if (pending) return pending;
    return shiftsMap?.[k] || null;
  };

  for (const k of candidateKeys) {
    if (!k.endsWith(`_${dateStr}`) || k === key) continue;
    const sh = readShift(k);
    if (!sh || sh.isDeleted || !sh.isExtended || sh.isEarlyStart) continue;
    const shPos = normalizePlanningPositionName(sh.coversPositionName || sh.positionName || '');
    if (shPos !== posNorm) continue;
    const shBand = sh.coversBandCode ? normBand(sh.coversBandCode) : '';
    if (shBand && band && shBand !== band) continue;
    partnerKey = k;
    if (sh.coveragePackageId) sharedPkg = sh.coveragePackageId;
    break;
  }

  const pkgId = sharedPkg || `sla_ext_pair_${dateStr}_${band}_${posNorm}`;
  const sharedMeta = {
    coveragePackageId: pkgId,
    coversBandCode: band,
    coversPositionName: gapPosition,
    coverageType: 'ABSENCE_COVERAGE',
    coverageMode: 'SPLIT',
    coverageSegmentRole: 'EXTENSION',
    coverageStatus: partnerKey ? 'COVERED' : 'PARTIAL',
  };

  const patch: Record<string, any> = { ...changes };
  patch[key] = { ...cur, ...sharedMeta };
  if (partnerKey) {
    const partner = readShift(partnerKey);
    if (partner) {
      patch[partnerKey] = { ...partner, ...sharedMeta, coverageStatus: 'COVERED', isTemp: true };
    }
  }
  return patch;
}

export function applyShiftExtensionFromCell(
  baseChanges: Record<string, any>,
  opts: {
    objectiveId: string;
    clientId?: string;
    dateStr: string;
    primaryEmpId: string;
    primaryExtraHours: number;
    secondEmpId?: string | null;
    secondExtraHours?: number | null;
    gapBand?: string | null;
    gapPosition?: string | null;
    positionStructure?: VacancyPositionSla[];
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
    authorizeFrancoTrabajado?: boolean;
  },
): Record<string, any> {
  const hasDual = !!(opts.secondEmpId && opts.gapBand && opts.gapPosition);
  if (hasDual) {
    const extShift = resolveEmployeeShift(opts.primaryEmpId, opts.dateStr, opts.shiftsMap, baseChanges);
    const secondShift = resolveEmployeeShift(opts.secondEmpId!, opts.dateStr, opts.shiftsMap, baseChanges);
    const input: OperationalGapCloseInput = {
      objectiveId: opts.objectiveId,
      clientId: opts.clientId,
      dateStr: opts.dateStr,
      gapPosition: opts.gapPosition!,
      gapBand: opts.gapBand!,
      extEmpId: opts.primaryEmpId,
      secondEmpId: opts.secondEmpId!,
      extHomePosition: extShift?.positionName,
      extBaseCode: extShift?.code,
      secondBaseCode: secondShift?.code,
      extExtraHours: opts.primaryExtraHours,
      secondExtExtraHours: opts.secondExtraHours != null ? opts.secondExtraHours : opts.primaryExtraHours,
      positionStructure: opts.positionStructure,
      authorizeFrancoTrabajado: opts.authorizeFrancoTrabajado,
    };
    return applyOperationalGapCloseToChanges(baseChanges, input, {
      shiftsMap: opts.shiftsMap,
      employeesById: opts.employeesById,
    });
  }

  let changes = applySingleShiftExtension(baseChanges, {
    shiftsMap: opts.shiftsMap,
    positionStructure: opts.positionStructure,
  }, {
    objectiveId: opts.objectiveId,
    empId: opts.primaryEmpId,
    dateStr: opts.dateStr,
    extraHours: opts.primaryExtraHours,
    coversBandCode: opts.gapBand,
    coversPositionName: opts.gapPosition,
  });

  if (opts.gapBand && opts.gapPosition) {
    changes = synchronizeDualExtensionPackage(
      changes,
      opts.dateStr,
      opts.primaryEmpId,
      opts.gapBand,
      opts.gapPosition,
      opts.shiftsMap,
    );
  }
  return changes;
}

export function isShiftEligibleForExtension(shift: Record<string, any> | null | undefined): boolean {
  if (!shift || shift.isDeleted) return false;
  const code = String(shift.code || '').toUpperCase();
  return !!code && !NON_WORK.has(code);
}
