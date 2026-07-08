/**
 * VPLAN — auditoría detallada de cobertura SLA (slots, candidatos, bloqueos).
 */

import { wouldExceedCctWorkStreak } from './vplan.cct-enforce';
import { transitionIsLegal, restHoursBetweenShiftAssignments, workBand } from './vplan.cycle-continuity';
import type { VplanExistingAssignment } from './vplan.firestore';
import { isVirtualEmployeeId, type VplanPositionDef } from './vplan.positions';
import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { normBandCode } from './vplan.sla-enforce';
import type {
  VplanAssignment,
  VplanCoverageAuditReport,
  VplanCoverageGapCandidate,
  VplanCoverageGapDetail,
  VplanDemandModel,
  VplanScheduleDraft,
} from './vplan.types';

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR']);
const ABSENCE = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const FRANCO = new Set(['F', 'FF', 'FP']);

function isWorkCode(code: string): boolean {
  const c = String(code || '').toUpperCase();
  return !!c && !NON_BILLABLE.has(c) && !ABSENCE.has(c);
}

function resolveSlotPosition(
  a: VplanAssignment,
  defaultPositionByEmp: Record<string, string>,
): string {
  const tagged = String(a.positionName || '').trim();
  if (tagged) return tagged;
  const fallback = String(defaultPositionByEmp[a.employeeId] || '').trim();
  if (isVirtualEmployeeId(fallback)) return '';
  return fallback;
}

function countSlots(
  assignments: VplanAssignment[],
  defaultPositionByEmp: Record<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of assignments) {
    const code = String(a.code || '').toUpperCase();
    if (!code || NON_BILLABLE.has(code) || ABSENCE.has(code)) continue;
    if (isVirtualEmployeeId(a.employeeId)) continue;
    const pos = resolveSlotPosition(a, defaultPositionByEmp);
    if (!pos) continue;
    const k = `${a.dateStr}__${pos}__${normBandCode(code)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function prevWorkBand(
  assignments: VplanAssignment[],
  empId: string,
  dateStrs: string[],
  dateStr: string,
  prevMonth?: VplanExistingAssignment[],
): { band: ReturnType<typeof workBand>; fromDate: string } | null {
  const idx = dateStrs.indexOf(dateStr);
  for (let i = idx - 1; i >= 0; i--) {
    const d = dateStrs[i]!;
    const a = assignments.find((x) => x.employeeId === empId && x.dateStr === d);
    const b = workBand(String(a?.code || ''));
    if (b) return { band: b, fromDate: d };
    const c = String(a?.code || '').toUpperCase();
    if (FRANCO.has(c)) return null;
  }
  if (prevMonth?.length) {
    const rows = prevMonth.filter((a) => a.employeeId === empId).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    for (const r of rows) {
      const b = workBand(String(r.code || ''));
      if (b) return { band: b, fromDate: r.dateStr };
      if (FRANCO.has(String(r.code || '').toUpperCase())) break;
    }
  }
  return null;
}

export function evaluateCoverageCandidate(opts: {
  empId: string;
  dateStr: string;
  shiftCode: string;
  assignments: VplanAssignment[];
  dateStrs: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
  /** FT: omite bloque descanso CCT obligatorio (mantiene tope racha trabajo). */
  francoTrabajado?: boolean;
}): { canAssign: boolean; blockReason?: string } {
  const current = opts.assignments.find(
    (a) => a.employeeId === opts.empId && a.dateStr === opts.dateStr,
  );
  const currentCode = String(current?.code || 'F').toUpperCase();

  const cct = wouldExceedCctWorkStreak({
    assignments: opts.assignments,
    dateStrs: opts.dateStrs,
    empId: opts.empId,
    dateStr: opts.dateStr,
    shiftCode: opts.shiftCode,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    rules: opts.rules,
    allowFrancoTrabajado: opts.francoTrabajado === true,
  });
  if (!cct.ok) return { canAssign: false, blockReason: cct.reason };

  const prevWork = prevWorkBand(
    opts.assignments,
    opts.empId,
    opts.dateStrs,
    opts.dateStr,
    opts.previousMonthAssignments,
  );
  const next = workBand(opts.shiftCode);
  const minRest = opts.rules?.minRestHoursBetweenBands ?? 12;
  if (prevWork?.band && next) {
    const legal = transitionIsLegal(
      prevWork.band,
      next,
      0,
      minRest,
      { prevDate: prevWork.fromDate, nextDate: opts.dateStr },
    );
    if (!legal) {
      const restH = restHoursBetweenShiftAssignments(
        prevWork.fromDate,
        prevWork.band,
        opts.dateStr,
        next,
      );
      return {
        canAssign: false,
        blockReason: `Descanso ${Math.round(restH * 10) / 10}h < ${minRest}h (${prevWork.band} ${prevWork.fromDate} → ${next} ${opts.dateStr})`,
      };
    }
  }

  const dateIdx = opts.dateStrs.indexOf(opts.dateStr);
  if (dateIdx >= 0 && dateIdx < opts.dateStrs.length - 1 && next) {
    const nextDate = opts.dateStrs[dateIdx + 1]!;
    const nextCell = opts.assignments.find(
      (a) => a.employeeId === opts.empId && a.dateStr === nextDate,
    );
    const nextDayCode = String(nextCell?.code || '').toUpperCase();
    const nextDayBand = workBand(nextDayCode);
    if (nextDayBand && isWorkCode(nextDayCode)) {
      const forwardLegal = transitionIsLegal(
        next,
        nextDayBand,
        0,
        minRest,
        { prevDate: opts.dateStr, nextDate },
      );
      if (!forwardLegal) {
        const restH = restHoursBetweenShiftAssignments(
          opts.dateStr,
          next,
          nextDate,
          nextDayBand,
        );
        return {
          canAssign: false,
          blockReason: `Descanso ${Math.round(restH * 10) / 10}h < ${minRest}h (${next} ${opts.dateStr} → ${nextDayBand} ${nextDate})`,
        };
      }
    }
  }

  return { canAssign: true };
}

function employeeOccupiesSlot(
  empId: string,
  dateStr: string,
  positionName: string,
  band: string,
  assignments: VplanAssignment[],
  defaultPositionByEmp: Record<string, string>,
): boolean {
  const cell = assignments.find((a) => a.employeeId === empId && a.dateStr === dateStr);
  if (!cell) return false;
  const code = String(cell.code || '').toUpperCase();
  if (!isWorkCode(code) || normBandCode(code) !== normBandCode(band)) return false;
  return resolveSlotPosition(cell, defaultPositionByEmp) === positionName;
}

function candidateSortRank(c: VplanCoverageGapCandidate): number {
  if (c.canAssign) return 0;
  if (c.blockReason?.startsWith('Ya asignado')) return 3;
  return 1;
}

function buildSubgroupByPosition(
  defaultPositionByEmp: Record<string, string>,
): Map<string, string[]> {
  const subgroupByPos = new Map<string, string[]>();
  for (const [empId, posName] of Object.entries(defaultPositionByEmp)) {
    if (isVirtualEmployeeId(empId)) continue;
    const name = String(posName || '').trim();
    if (!name || isVirtualEmployeeId(name)) continue;
    if (!subgroupByPos.has(name)) subgroupByPos.set(name, []);
    subgroupByPos.get(name)!.push(empId);
  }
  return subgroupByPos;
}

/**
 * Auditoría slot a slot: demanda SLA vs grilla, con candidatos y motivos de bloqueo.
 */
export function buildDetailedCoverageAudit(opts: {
  draft: VplanScheduleDraft;
  demand: VplanDemandModel;
  positions: VplanPositionDef[];
  defaultPositionByEmp: Record<string, string>;
  dateStrs: string[];
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  employeeNames?: Record<string, string>;
  rules?: PlanningRulesConfig;
}): VplanCoverageAuditReport {
  const slotCounts = countSlots(opts.draft.assignments, opts.defaultPositionByEmp);
  const gaps: VplanCoverageGapDetail[] = [];
  let totalMissing = 0;
  let totalExcess = 0;

  const subgroupByPos = buildSubgroupByPosition(opts.defaultPositionByEmp);

  for (const day of opts.demand.dayDemands) {
    const { dateStr, dayLetter } = day;
    for (const posDemand of day.positions) {
      const pos = opts.positions.find((p) => p.positionName === posDemand.positionName);
      if (!pos) continue;

      for (const [shiftCode, qtyRequired] of Object.entries(posDemand.bandSlots)) {
        const band = normBandCode(shiftCode);
        const key = `${dateStr}__${posDemand.positionName}__${band}`;
        const assigned = slotCounts.get(key) || 0;
        const missing = Math.max(0, qtyRequired - assigned);
        const excess = Math.max(0, assigned - qtyRequired);
        totalMissing += missing;
        totalExcess += excess;

        if (missing <= 0) continue;

        const candidates: VplanCoverageGapCandidate[] = [];
        const pool = subgroupByPos.get(posDemand.positionName) || [];
        const targetShift = shiftCode.toUpperCase();

        for (const empId of pool) {
          if (isVirtualEmployeeId(empId)) continue;

          const cell = opts.draft.assignments.find(
            (a) => a.employeeId === empId && a.dateStr === dateStr,
          );
          const currentCode = String(cell?.code || 'F').toUpperCase();
          const cellPos = String(cell?.positionName || '').trim();
          const defaultPos = String(opts.defaultPositionByEmp[empId] || '').trim();
          const evalResult = evaluateCoverageCandidate({
            empId,
            dateStr,
            shiftCode,
            assignments: opts.draft.assignments,
            dateStrs: opts.dateStrs,
            cycle: opts.cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            rules: opts.rules,
          });

          const isFranco = FRANCO.has(currentCode);
          const sameBand = isWorkCode(currentCode) && normBandCode(currentCode) === normBandCode(targetShift);
          const alreadyAssignedHere = employeeOccupiesSlot(
            empId,
            dateStr,
            posDemand.positionName,
            targetShift,
            opts.draft.assignments,
            opts.defaultPositionByEmp,
          );

          let canAssign = false;
          let blockReason = evalResult.blockReason;

          if (evalResult.canAssign) {
            if (alreadyAssignedHere) {
              canAssign = false;
              blockReason = `Ya asignado ${targetShift} (${assigned}/${qtyRequired} en ${posDemand.positionName})`;
            } else if (isFranco && defaultPos === posDemand.positionName) {
              canAssign = true;
            } else if (sameBand) {
              canAssign = true;
              blockReason = cellPos && cellPos !== posDemand.positionName
                ? `Tag puesto: ${targetShift} en ${cellPos} → ${posDemand.positionName}`
                : `Falta positionName en ${posDemand.positionName}`;
            } else if (isWorkCode(currentCode)) {
              canAssign = false;
              blockReason = `Ocupado con ${currentCode}${cellPos ? ` (${cellPos})` : ''}`;
            }
          }

          candidates.push({
            employeeId: empId,
            displayName: opts.employeeNames?.[empId],
            currentCode,
            canAssign,
            blockReason,
          });
        }

        gaps.push({
          dateStr,
          dayLetter,
          positionName: posDemand.positionName,
          shiftCode: targetShift,
          required: qtyRequired,
          assigned,
          missing,
          candidates: candidates.sort((a, b) => {
            const ra = candidateSortRank(a);
            const rb = candidateSortRank(b);
            if (ra !== rb) return ra - rb;
            if (a.canAssign && !b.canAssign) return -1;
            if (!a.canAssign && b.canAssign) return 1;
            return 0;
          }),
        });
      }
    }
  }

  return {
    ok: totalMissing === 0 && totalExcess === 0,
    totalGaps: gaps.length,
    totalMissingSlots: totalMissing,
    totalExcessSlots: totalExcess,
    gaps,
  };
}
