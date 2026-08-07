/**
 * Cierre de hueco SLA sin titular en licencia (ext + cierre desde pie de cobertura).
 */

import type { RecompositionPackage } from './planningRecomposition.types';
import { buildRecompositionPendingUpdates } from './planningRecompositionApply';
import { vacancySecondSegmentIsTailExtension } from './vacancySplitBands';
import {
  resolveVacancySplitSegmentTimes,
  vacancySplitUsesManualExtraHours,
} from './vacancyCoverage';
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
  splitTimes: { ext: { from: string; to: string }; adel: { from: string; to: string } },
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
  const splitTimes = { ext: dualPlan.first, adel: dualPlan.second };
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
