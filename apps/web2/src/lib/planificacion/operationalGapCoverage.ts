/**
 * Cierre de hueco SLA sin titular en licencia (ext + cierre desde pie de cobertura).
 */

import type { RecompositionPackage } from './planningRecomposition.types';
import {
  buildRecompositionPendingUpdates,
  isPlannedFrancoShift,
  resolveEmployeeShift,
} from './planningRecompositionApply';
import { neighborBandsForVacancyGap, vacancySecondSegmentIsTailExtension } from './vacancySplitBands';
import {
  resolveVacancySplitSegmentTimes,
  vacancySplitUsesManualExtraHours,
} from './vacancyCoverage';
import { listVacancyGapBandOptions } from './vacancyGapBands';
import type { VacancyPositionSla } from './vacancySplitBands';

export type OperationalGapCloseInput = {
  objectiveId: string;
  clientId?: string;
  dateStr: string;
  gapPosition: string;
  gapBand: string;
  extEmpId: string;
  secondEmpId: string;
  extHomePosition?: string;
  extBaseCode?: string;
  secondBaseCode?: string;
  extExtraHours?: number | null;
  secondExtExtraHours?: number | null;
  positionStructure?: VacancyPositionSla[];
  authorizeFrancoTrabajado?: boolean;
  /** Día de la celda del guardia de extensión (default: dateStr del hueco). */
  extApplyDateStr?: string;
};

export function buildOperationalGapRecompositionPackage(
  input: OperationalGapCloseInput,
  splitTimes: {
    ext: { from: string; to: string };
    adel: { from: string; to: string };
    extExtraHours?: number;
    adelExtraHours?: number;
  },
): RecompositionPackage {
  const gapBand = String(input.gapBand || '').toUpperCase();
  return {
    id: `sla_gap_${input.dateStr}_${gapBand}_${Date.now()}`,
    type: 'ABSENCE_COVERAGE',
    mode: 'operational_gap',
    objectiveId: input.objectiveId,
    dateStr: input.dateStr,
    target: {
      employeeId: '',
      dateStr: input.dateStr,
      positionName: input.gapPosition,
      code: gapBand,
      label: `${input.gapPosition} · ${gapBand}`,
      kind: 'sla_gap',
    },
    gapFrom: splitTimes.ext.from,
    gapTo: splitTimes.adel.to,
    gapPositionName: input.gapPosition,
    extension: {
      employeeId: input.extEmpId,
      role: 'EXTENSION',
      positionName: input.gapPosition,
      fromTime: splitTimes.ext.from,
      toTime: splitTimes.ext.to,
      homePositionName: input.extHomePosition,
      baseCode: input.extBaseCode,
      extraHours: splitTimes.extExtraHours,
      applyDateStr: input.extApplyDateStr && input.extApplyDateStr !== input.dateStr
        ? input.extApplyDateStr
        : undefined,
    },
    earlyStart: {
      employeeId: input.secondEmpId,
      role: vacancySecondSegmentIsTailExtension(gapBand) ? 'EXTENSION' : 'EARLY_START',
      positionName: input.gapPosition,
      fromTime: splitTimes.adel.from,
      toTime: splitTimes.adel.to,
      baseCode: input.secondBaseCode,
      extraHours: splitTimes.adelExtraHours,
    },
  };
}

export function applyOperationalGapCloseToChanges(
  baseChanges: Record<string, any>,
  input: OperationalGapCloseInput,
  ctx: {
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
  },
): Record<string, any> {
  const manual = vacancySplitUsesManualExtraHours({
    extExtraHours: input.extExtraHours,
    secondExtExtraHours: input.secondExtExtraHours,
  });
  const dualPlan = resolveVacancySplitSegmentTimes(
    input.positionStructure,
    input.gapBand,
    input.gapPosition,
    { positionName: input.extHomePosition || input.gapPosition, code: input.extBaseCode },
    { positionName: input.gapPosition, code: input.secondBaseCode },
    manual ? input.extExtraHours : null,
    manual ? input.secondExtExtraHours : null,
  );
  const splitTimes = {
    ext: dualPlan.first,
    adel: dualPlan.second,
    extExtraHours: dualPlan.firstExtraHours,
    adelExtraHours: dualPlan.secondExtraHours,
  };
  const pkg = buildOperationalGapRecompositionPackage(input, splitTimes);
  const updates = buildRecompositionPendingUpdates(pkg, {
    shiftsMap: ctx.shiftsMap,
    pendingChanges: baseChanges,
    employeesById: ctx.employeesById,
    objectiveId: input.objectiveId,
    clientId: input.clientId,
    authorizeFrancoTrabajado: input.authorizeFrancoTrabajado,
  });
  return { ...baseChanges, ...updates };
}

export type SingleWorkerGapCloseInput = {
  objectiveId: string;
  clientId?: string;
  dateStr: string;
  gapPosition: string;
  gapBand: string;
  employeeId: string;
  applyDateStr?: string;
  positionStructure?: VacancyPositionSla[];
};

/** Una sola persona cubre toda la banda del hueco (extiende M o adelanta N). */
export function applySingleWorkerFullGapCloseToChanges(
  baseChanges: Record<string, any>,
  input: SingleWorkerGapCloseInput,
  ctx: {
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
  },
): Record<string, any> {
  const empId = String(input.employeeId || '').trim();
  if (!empId) throw new Error('Elegí un guardia para cubrir la banda completa.');
  const applyDate = input.applyDateStr || input.dateStr;
  const base = resolveEmployeeShift(empId, applyDate, ctx.shiftsMap, baseChanges);
  if (!base || base.isDeleted) {
    throw new Error('El guardia no tiene turno laboral ese día.');
  }
  if (isPlannedFrancoShift(base)) {
    throw new Error('Para un franco usá la opción Franco trabajado (FT).');
  }

  const band = String(input.gapBand || '').toUpperCase();
  const opt = listVacancyGapBandOptions(input.positionStructure, input.gapPosition)
    .find((o) => o.code === band);
  const hours = opt?.hours || 8;
  const from = opt?.startTime || '15:00';
  const to = opt?.endTime || '23:00';
  const hoursLabel = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  const neighbors = neighborBandsForVacancyGap(input.positionStructure, input.gapPosition, band);
  const code = String(base.code || '').toUpperCase();
  const isExt = code === String(neighbors.extensionBand || '').toUpperCase();
  const isAdel = code === String(neighbors.earlyStartBand || '').toUpperCase();
  if (!isExt && !isAdel) {
    throw new Error(`Solo se puede cubrir la banda completa desde la banda anterior (${neighbors.extensionBand}) o la siguiente (${neighbors.earlyStartBand}).`);
  }

  const emp = ctx.employeesById[empId];
  const shortName = String(emp?.name || empId).split(',')[0];
  const key = `${empId}_${applyDate}`;
  const roleLabel = isExt ? 'extiende' : 'adelanta';
  const pkgId = `sla_full_${input.dateStr}_${band}_${empId}_${Date.now()}`;

  return {
    ...baseChanges,
    [key]: {
      ...base,
      isFranco: false,
      isExtended: isExt,
      isEarlyStart: isAdel && !isExt,
      extExtraHours: hours,
      isTemp: true,
      coveragePackageId: pkgId,
      coverageType: 'ABSENCE_COVERAGE',
      coverageMode: 'FULL_BAND',
      coverageSegmentRole: isExt ? 'EXTENSION' : 'EARLY_START',
      coverageStatus: 'COVERED',
      coversPositionName: input.gapPosition,
      coversBandCode: band,
      adjustedEndTime: isExt ? to : base.adjustedEndTime,
      adjustedStartTime: isAdel && !isExt ? from : base.adjustedStartTime,
      segmentFromTime: from,
      segmentToTime: to,
      coverageNote: `${shortName} ${roleLabel} ${from}–${to} · cubre ${input.gapPosition} ${band} (${hoursLabel} h)`,
      comments: `Cubre hueco SLA completo · ${input.gapPosition} ${band} ${from}–${to}`,
    },
  };
}

export type FrancoTrabajadoGapCloseInput = {
  objectiveId: string;
  clientId?: string;
  dateStr: string;
  gapPosition: string;
  gapBand: string;
  employeeId: string;
  positionStructure?: VacancyPositionSla[];
  authorizeFrancoTrabajado?: boolean;
};

/** Cubre el hueco SLA completo con un guardia de franco → FT (costo extra CCT). */
export function applyFrancoTrabajadoGapCloseToChanges(
  baseChanges: Record<string, any>,
  input: FrancoTrabajadoGapCloseInput,
  ctx: {
    shiftsMap: Record<string, any>;
    employeesById: Record<string, any>;
  },
): Record<string, any> {
  const empId = String(input.employeeId || '').trim();
  if (!empId) throw new Error('Elegí un guardia de franco.');
  const base = resolveEmployeeShift(empId, input.dateStr, ctx.shiftsMap, baseChanges);
  if (!base || base.isDeleted) {
    throw new Error('El guardia no tiene celda ese día.');
  }
  if (!isPlannedFrancoShift(base)) {
    throw new Error('El guardia no está de franco planificado ese día.');
  }
  if (!input.authorizeFrancoTrabajado) {
    const emp = ctx.employeesById[empId];
    const name = emp?.name || empId;
    throw new Error(
      `FRANCO_COVERAGE:${name} tiene franco planificado (${String(base.code || 'F').toUpperCase()}) el ${input.dateStr} — requiere PIN de supervisor (FT / costo extra).`,
    );
  }

  const band = String(input.gapBand || '').toUpperCase();
  const opt = listVacancyGapBandOptions(input.positionStructure, input.gapPosition)
    .find((o) => o.code === band);
  const hours = opt?.hours || 8;
  const startTime = opt?.startTime || '15:00';
  const endTime = opt?.endTime || '23:00';
  const key = `${empId}_${input.dateStr}`;
  const emp = ctx.employeesById[empId];
  const name = emp?.name || empId;
  const pkgId = `sla_ft_${input.dateStr}_${band}_${empId}_${Date.now()}`;

  return {
    ...baseChanges,
    [key]: {
      ...base,
      code: band,
      name: `Franco trabajado · ${band}`,
      hours,
      startTime,
      endTime,
      positionName: input.gapPosition,
      objectiveId: input.objectiveId,
      clientId: input.clientId || base.clientId,
      isFranco: false,
      isFrancoTrabajado: true,
      isExtended: false,
      isEarlyStart: false,
      isTemp: true,
      coveragePackageId: pkgId,
      coverageType: 'ABSENCE_COVERAGE',
      coverageMode: 'FRANCO_TRABAJADO',
      coverageSegmentRole: 'SUBSTITUTE',
      coverageStatus: 'COVERED',
      coversPositionName: input.gapPosition,
      coversBandCode: band,
      coverageNote: `FT cubre hueco SLA ${input.gapPosition} · ${band} ${startTime}–${endTime}`,
      comments: `Franco trabajado — ${name.split(',')[0]} cubre ${input.gapPosition} ${band}`,
    },
  };
}
