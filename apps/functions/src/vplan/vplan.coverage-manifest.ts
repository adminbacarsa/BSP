/**
 * VPLAN — manifiesto de slots a cubrir (derivado de dayDemands / planningTarget).
 */

import { normBandCode } from './vplan.sla-enforce';
import { sortPositionPlanningRules } from './vplan.coverage-target';
import type {
  VplanCoverageManifest,
  VplanCoverageManifestSlot,
  VplanDayDemand,
  VplanPlanningTarget,
  VplanPositionPlanningRule,
} from './vplan.types';

function buildSlotsFromDayDemands(dayDemands: VplanDayDemand[]): VplanCoverageManifestSlot[] {
  const slots: VplanCoverageManifestSlot[] = [];
  let seq = 0;

  for (const day of dayDemands) {
    for (const pos of day.positions) {
      for (const [bandRaw, qtyRequired] of Object.entries(pos.bandSlots)) {
        const band = normBandCode(bandRaw);
        const qty = Math.max(0, Number(qtyRequired) || 0);
        for (let unit = 0; unit < qty; unit += 1) {
          seq += 1;
          slots.push({
            id: `${day.dateStr}__${pos.positionName}__${band}__${unit}`,
            dateStr: day.dateStr,
            dayLetter: day.dayLetter,
            positionName: pos.positionName,
            band,
            unitIndex: unit,
            shiftCode: bandRaw.toUpperCase(),
          });
        }
      }
    }
  }

  return slots;
}

function buildPositionSummaries(
  positionRules: VplanPositionPlanningRule[],
): VplanCoverageManifest['byPosition'] {
  return sortPositionPlanningRules(positionRules).map((rule) => ({
    positionName: rule.positionName,
    qty: rule.qty,
    requiredSlots: rule.monthlyTotalSlots,
    filledSlots: 0,
    missingSlots: rule.monthlyTotalSlots,
    dailyBandsLabel: rule.dailyBandsLabel,
    activeDayCount: rule.activeDayCount,
  }));
}

export function buildVplanCoverageManifest(opts: {
  dayDemands: VplanDayDemand[];
  planningTarget: VplanPlanningTarget;
}): VplanCoverageManifest {
  const slots = buildSlotsFromDayDemands(opts.dayDemands);
  const byPosition = buildPositionSummaries(opts.planningTarget.positionRules);

  return {
    totalRequiredSlots: opts.planningTarget.totalMonthlySlots,
    totalRequiredHours: opts.planningTarget.totalMonthlyHours,
    slots,
    byPosition,
    summaryLabel: `${opts.planningTarget.totalMonthlySlots} turnos/slot · ${opts.planningTarget.totalFormulaLabel}`,
  };
}

export function countFilledSlotsFromAssignments(opts: {
  assignments: Array<{ employeeId: string; dateStr: string; code: string; positionName?: string }>;
  defaultPositionByEmp: Record<string, string>;
  manifest: VplanCoverageManifest;
}): {
  filledSlots: number;
  missingSlots: number;
  byPosition: VplanCoverageManifest['byPosition'];
} {
  const slotCounts = new Map<string, number>();

  for (const a of opts.assignments) {
    const code = String(a.code || '').toUpperCase();
    if (!code || ['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR', 'V', 'L', 'A', 'E', 'PG', 'AA'].includes(code)) {
      continue;
    }
    const pos = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
    if (!pos) continue;
    const band = normBandCode(code);
    const key = `${a.dateStr}__${pos}__${band}`;
    slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
  }

  const requiredByPos = new Map<string, number>();
  for (const slot of opts.manifest.slots) {
    requiredByPos.set(slot.positionName, (requiredByPos.get(slot.positionName) || 0) + 1);
  }

  const filledByPos = new Map<string, number>();
  for (const [key, count] of slotCounts) {
    const parts = key.split('__');
    const posName = parts[1];
    if (!posName) continue;
    filledByPos.set(posName, (filledByPos.get(posName) || 0) + count);
  }

  let filledTotal = 0;
  const byPosition = opts.manifest.byPosition.map((row) => {
    const required = requiredByPos.get(row.positionName) ?? row.requiredSlots;
    const filled = Math.min(required, filledByPos.get(row.positionName) ?? 0);
    filledTotal += filled;
    return {
      ...row,
      requiredSlots: required,
      filledSlots: filled,
      missingSlots: Math.max(0, required - filled),
    };
  });

  const totalRequired = opts.manifest.totalRequiredSlots;
  return {
    filledSlots: Math.min(totalRequired, filledTotal),
    missingSlots: Math.max(0, totalRequired - filledTotal),
    byPosition,
  };
}
