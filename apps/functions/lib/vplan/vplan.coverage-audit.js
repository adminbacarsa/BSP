"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCoverageCandidate = evaluateCoverageCandidate;
exports.buildDetailedCoverageAudit = buildDetailedCoverageAudit;
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_positions_1 = require("./vplan.positions");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR']);
const ABSENCE = new Set(['V', 'L', 'A', 'E', 'PG', 'AA']);
const FRANCO = new Set(['F', 'FF', 'FP']);
function isWorkCode(code) {
    const c = String(code || '').toUpperCase();
    return !!c && !NON_BILLABLE.has(c) && !ABSENCE.has(c);
}
function resolveSlotPosition(a, defaultPositionByEmp) {
    const tagged = String(a.positionName || '').trim();
    if (tagged)
        return tagged;
    const fallback = String(defaultPositionByEmp[a.employeeId] || '').trim();
    if ((0, vplan_positions_1.isVirtualEmployeeId)(fallback))
        return '';
    return fallback;
}
function countSlots(assignments, defaultPositionByEmp) {
    const counts = new Map();
    for (const a of assignments) {
        const code = String(a.code || '').toUpperCase();
        if (!code || NON_BILLABLE.has(code) || ABSENCE.has(code))
            continue;
        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
            continue;
        const pos = resolveSlotPosition(a, defaultPositionByEmp);
        if (!pos)
            continue;
        const k = `${a.dateStr}__${pos}__${(0, vplan_sla_enforce_1.normBandCode)(code)}`;
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
}
function prevWorkBand(assignments, empId, dateStrs, dateStr, prevMonth) {
    const idx = dateStrs.indexOf(dateStr);
    for (let i = idx - 1; i >= 0; i--) {
        const d = dateStrs[i];
        const a = assignments.find((x) => x.employeeId === empId && x.dateStr === d);
        const b = (0, vplan_cycle_continuity_1.workBand)(String(a?.code || ''));
        if (b)
            return { band: b, fromDate: d };
        const c = String(a?.code || '').toUpperCase();
        if (FRANCO.has(c))
            return null;
    }
    if (prevMonth?.length) {
        const rows = prevMonth.filter((a) => a.employeeId === empId).sort((a, b) => b.dateStr.localeCompare(a.dateStr));
        for (const r of rows) {
            const b = (0, vplan_cycle_continuity_1.workBand)(String(r.code || ''));
            if (b)
                return { band: b, fromDate: r.dateStr };
            if (FRANCO.has(String(r.code || '').toUpperCase()))
                break;
        }
    }
    return null;
}
function evaluateCoverageCandidate(opts) {
    const current = opts.assignments.find((a) => a.employeeId === opts.empId && a.dateStr === opts.dateStr);
    const currentCode = String(current?.code || 'F').toUpperCase();
    const cct = (0, vplan_cct_enforce_1.wouldExceedCctWorkStreak)({
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
    if (!cct.ok)
        return { canAssign: false, blockReason: cct.reason };
    const prevWork = prevWorkBand(opts.assignments, opts.empId, opts.dateStrs, opts.dateStr, opts.previousMonthAssignments);
    const next = (0, vplan_cycle_continuity_1.workBand)(opts.shiftCode);
    const minRest = opts.rules?.minRestHoursBetweenBands ?? 12;
    if (prevWork?.band && next) {
        const legal = (0, vplan_cycle_continuity_1.transitionIsLegal)(prevWork.band, next, 0, minRest, { prevDate: prevWork.fromDate, nextDate: opts.dateStr });
        if (!legal) {
            const restH = (0, vplan_cycle_continuity_1.restHoursBetweenShiftAssignments)(prevWork.fromDate, prevWork.band, opts.dateStr, next);
            return {
                canAssign: false,
                blockReason: `Descanso ${Math.round(restH * 10) / 10}h < ${minRest}h (${prevWork.band} ${prevWork.fromDate} → ${next} ${opts.dateStr})`,
            };
        }
    }
    const dateIdx = opts.dateStrs.indexOf(opts.dateStr);
    if (dateIdx >= 0 && dateIdx < opts.dateStrs.length - 1 && next) {
        const nextDate = opts.dateStrs[dateIdx + 1];
        const nextCell = opts.assignments.find((a) => a.employeeId === opts.empId && a.dateStr === nextDate);
        const nextDayCode = String(nextCell?.code || '').toUpperCase();
        const nextDayBand = (0, vplan_cycle_continuity_1.workBand)(nextDayCode);
        if (nextDayBand && isWorkCode(nextDayCode)) {
            const forwardLegal = (0, vplan_cycle_continuity_1.transitionIsLegal)(next, nextDayBand, 0, minRest, { prevDate: opts.dateStr, nextDate });
            if (!forwardLegal) {
                const restH = (0, vplan_cycle_continuity_1.restHoursBetweenShiftAssignments)(opts.dateStr, next, nextDate, nextDayBand);
                return {
                    canAssign: false,
                    blockReason: `Descanso ${Math.round(restH * 10) / 10}h < ${minRest}h (${next} ${opts.dateStr} → ${nextDayBand} ${nextDate})`,
                };
            }
        }
    }
    return { canAssign: true };
}
function employeeOccupiesSlot(empId, dateStr, positionName, band, assignments, defaultPositionByEmp) {
    const cell = assignments.find((a) => a.employeeId === empId && a.dateStr === dateStr);
    if (!cell)
        return false;
    const code = String(cell.code || '').toUpperCase();
    if (!isWorkCode(code) || (0, vplan_sla_enforce_1.normBandCode)(code) !== (0, vplan_sla_enforce_1.normBandCode)(band))
        return false;
    return resolveSlotPosition(cell, defaultPositionByEmp) === positionName;
}
function candidateSortRank(c) {
    if (c.canAssign)
        return 0;
    if (c.blockReason?.startsWith('Ya asignado'))
        return 3;
    return 1;
}
function buildSubgroupByPosition(defaultPositionByEmp) {
    const subgroupByPos = new Map();
    for (const [empId, posName] of Object.entries(defaultPositionByEmp)) {
        if ((0, vplan_positions_1.isVirtualEmployeeId)(empId))
            continue;
        const name = String(posName || '').trim();
        if (!name || (0, vplan_positions_1.isVirtualEmployeeId)(name))
            continue;
        if (!subgroupByPos.has(name))
            subgroupByPos.set(name, []);
        subgroupByPos.get(name).push(empId);
    }
    return subgroupByPos;
}
function buildDetailedCoverageAudit(opts) {
    const slotCounts = countSlots(opts.draft.assignments, opts.defaultPositionByEmp);
    const gaps = [];
    let totalMissing = 0;
    let totalExcess = 0;
    const subgroupByPos = buildSubgroupByPosition(opts.defaultPositionByEmp);
    for (const day of opts.demand.dayDemands) {
        const { dateStr, dayLetter } = day;
        for (const posDemand of day.positions) {
            const pos = opts.positions.find((p) => p.positionName === posDemand.positionName);
            if (!pos)
                continue;
            for (const [shiftCode, qtyRequired] of Object.entries(posDemand.bandSlots)) {
                const band = (0, vplan_sla_enforce_1.normBandCode)(shiftCode);
                const key = `${dateStr}__${posDemand.positionName}__${band}`;
                const assigned = slotCounts.get(key) || 0;
                const missing = Math.max(0, qtyRequired - assigned);
                const excess = Math.max(0, assigned - qtyRequired);
                totalMissing += missing;
                totalExcess += excess;
                if (missing <= 0)
                    continue;
                const candidates = [];
                const pool = subgroupByPos.get(posDemand.positionName) || [];
                const targetShift = shiftCode.toUpperCase();
                for (const empId of pool) {
                    if ((0, vplan_positions_1.isVirtualEmployeeId)(empId))
                        continue;
                    const cell = opts.draft.assignments.find((a) => a.employeeId === empId && a.dateStr === dateStr);
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
                    const sameBand = isWorkCode(currentCode) && (0, vplan_sla_enforce_1.normBandCode)(currentCode) === (0, vplan_sla_enforce_1.normBandCode)(targetShift);
                    const alreadyAssignedHere = employeeOccupiesSlot(empId, dateStr, posDemand.positionName, targetShift, opts.draft.assignments, opts.defaultPositionByEmp);
                    let canAssign = false;
                    let blockReason = evalResult.blockReason;
                    if (evalResult.canAssign) {
                        if (alreadyAssignedHere) {
                            canAssign = false;
                            blockReason = `Ya asignado ${targetShift} (${assigned}/${qtyRequired} en ${posDemand.positionName})`;
                        }
                        else if (isFranco && defaultPos === posDemand.positionName) {
                            canAssign = true;
                        }
                        else if (sameBand) {
                            canAssign = true;
                            blockReason = cellPos && cellPos !== posDemand.positionName
                                ? `Tag puesto: ${targetShift} en ${cellPos} → ${posDemand.positionName}`
                                : `Falta positionName en ${posDemand.positionName}`;
                        }
                        else if (isWorkCode(currentCode)) {
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
                        if (ra !== rb)
                            return ra - rb;
                        if (a.canAssign && !b.canAssign)
                            return -1;
                        if (!a.canAssign && b.canAssign)
                            return 1;
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
//# sourceMappingURL=vplan.coverage-audit.js.map