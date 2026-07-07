/**
 * VPLAN Fase 5 — redistribución horaria hacia SLA.
 * Con plantilla suficiente (ej. 189h/guardia), asigna turnos en F de guardias
 * bajo el promedio antes de dar el mes por perdido.
 */

import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { resolvePlanningRules } from '../planning/planning-rules.service';
import { wouldExceedCctWorkStreak } from './vplan.cct-enforce';
import { protectedCellKey } from './vplan.cycle-continuity';
import type { VplanExistingAssignment } from './vplan.firestore';
import {
  isPositionActiveOnDay,
  isVirtualEmployeeId,
  shiftBandHours,
  shiftsForCycle,
  type VplanPositionDef,
} from './vplan.positions';
import { normBandCode } from './vplan.sla-enforce';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';

const FRANCO_POOL = new Set(['F', 'FF', 'FP']);
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR', 'V', 'L', 'A', 'E', 'PG', 'AA']);

function slotKey(dateStr: string, posName: string, band: string): string {
  return `${dateStr}__${posName}__${band}`;
}

function countBillableByEmp(assignments: VplanAssignment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of assignments) {
    const c = String(a.code || '').toUpperCase();
    if (NON_BILLABLE.has(c) || isVirtualEmployeeId(a.employeeId)) continue;
    map.set(a.employeeId, (map.get(a.employeeId) || 0) + (a.hours ?? 8));
  }
  return map;
}

function shiftAppliesOnDay(shift: { days?: string[] }, dayLetter: string): boolean {
  if (!Array.isArray(shift.days) || shift.days.length === 0) return true;
  return shift.days.includes(dayLetter);
}

function dailySlotLimit(pos: VplanPositionDef, shiftCode: string, dayLetter: string): number {
  if (!isPositionActiveOnDay(pos, dayLetter)) return 0;
  const qty = Math.max(1, Number(pos.qty) || 1);
  const shift = (pos.shifts || []).find(
    (s) => String(s.code || '').toUpperCase() === shiftCode,
  );
  if (!shift || !shiftAppliesOnDay(shift, dayLetter)) return 0;
  return qty;
}

export function rebalanceHoursTowardSla(opts: {
  draft: VplanScheduleDraft;
  dateStrs: Array<{ dateStr: string; dayLetter: string }>;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  cycle?: string;
  dateStrList?: string[];
  slaVendidas: number;
  employeeIds: string[];
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
  protectedCells?: Set<string>;
  tolerance?: number;
}): {
  draft: VplanScheduleDraft;
  log: VplanFixerLogEntry[];
  hoursAdded: number;
} {
  const log: VplanFixerLogEntry[] = [];
  const rules = resolvePlanningRules(opts.rules ?? null);
  const tolerance = opts.tolerance ?? rules.slaHoursTolerance ?? 8;
  const cycle = opts.cycle ?? '6+2';
  const dateStrList = opts.dateStrList ?? opts.dateStrs.map((d) => d.dateStr);
  const assignments = opts.draft.assignments.map((a) => ({ ...a }));
  const targetPerEmp = opts.employeeIds.length > 0
    ? opts.slaVendidas / opts.employeeIds.length
    : 0;

  let billable = 0;
  for (const a of assignments) {
    const c = String(a.code || '').toUpperCase();
    if (!NON_BILLABLE.has(c)) billable += a.hours ?? 8;
  }
  if (opts.slaVendidas <= 0 || billable >= opts.slaVendidas - tolerance) {
    return { draft: opts.draft, log, hoursAdded: 0 };
  }

  const hoursByEmp = countBillableByEmp(assignments);
  const daySlotCount = new Map<string, number>();
  for (const a of assignments) {
    const posName = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
    const code = String(a.code || '').toUpperCase();
    if (!posName || !WORK_CODES.has(code)) continue;
    const k = slotKey(a.dateStr, posName, normBandCode(code));
    daySlotCount.set(k, (daySlotCount.get(k) || 0) + 1);
  }

  let hoursAdded = 0;

  for (const { dateStr, dayLetter } of opts.dateStrs) {
    if (billable >= opts.slaVendidas - tolerance) break;

    for (const pos of opts.positions) {
      if (billable >= opts.slaVendidas - tolerance) break;
      const posName = pos.positionName;
      for (const shift of shiftsForCycle(pos, opts.cycle)) {
        const shiftCode = String(shift.code || '').toUpperCase();
        if (!shiftCode || NON_BILLABLE.has(shiftCode)) continue;
        if (!shiftAppliesOnDay(shift, dayLetter)) continue;
        const limit = dailySlotLimit(pos, shiftCode, dayLetter);
        if (limit <= 0) continue;

        const band = normBandCode(shiftCode);
        const key = slotKey(dateStr, posName, band);
        let used = daySlotCount.get(key) || 0;

        while (used < limit && billable < opts.slaVendidas - tolerance) {
          const candidates = assignments
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => {
              if (a.dateStr !== dateStr) return false;
              if (!opts.employeeIds.includes(a.employeeId)) return false;
              if (isVirtualEmployeeId(a.employeeId)) return false;
              if (opts.protectedCells?.has(protectedCellKey(a.employeeId, dateStr))) return false;
              const c = String(a.code || '').toUpperCase();
              if (!FRANCO_POOL.has(c)) return false;
              const empH = hoursByEmp.get(a.employeeId) || 0;
              if (empH >= targetPerEmp + 4) return false;
              const cct = wouldExceedCctWorkStreak({
                assignments,
                dateStrs: dateStrList,
                empId: a.employeeId,
                dateStr,
                shiftCode,
                cycle,
                previousMonthAssignments: opts.previousMonthAssignments,
                rules,
              });
              return cct.ok;
            })
            .sort((x, y) => {
              const xh = hoursByEmp.get(x.a.employeeId) || 0;
              const yh = hoursByEmp.get(y.a.employeeId) || 0;
              const xPos = opts.defaultPositionByEmp[x.a.employeeId] === posName ? 0 : 1;
              const yPos = opts.defaultPositionByEmp[y.a.employeeId] === posName ? 0 : 1;
              if (xPos !== yPos) return xPos - yPos;
              return xh - yh;
            });

          const pick = candidates[0];
          if (!pick) break;

          const h = shiftBandHours(shift);
          assignments[pick.i] = {
            ...assignments[pick.i]!,
            code: shiftCode,
            positionName: posName,
            hours: h,
          };
          hoursByEmp.set(pick.a.employeeId, (hoursByEmp.get(pick.a.employeeId) || 0) + h);
          billable += h;
          hoursAdded += h;
          used += 1;
          daySlotCount.set(key, used);
          log.push({
            code: 'HOUR_REBALANCE',
            message: `F → ${shiftCode} en ${posName} (${dateStr}) · ${pick.a.employeeId} bajo promedio`,
            employeeId: pick.a.employeeId,
            dateStr,
          });
        }
      }
    }
  }

  return {
    draft: { ...opts.draft, assignments },
    log,
    hoursAdded,
  };
}
