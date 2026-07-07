"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rebalanceHoursTowardSla = rebalanceHoursTowardSla;
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_positions_1 = require("./vplan.positions");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
const FRANCO_POOL = new Set(['F', 'FF', 'FP']);
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR', 'V', 'L', 'A', 'E', 'PG', 'AA']);
function slotKey(dateStr, posName, band) {
    return `${dateStr}__${posName}__${band}`;
}
function countBillableByEmp(assignments) {
    const map = new Map();
    for (const a of assignments) {
        const c = String(a.code || '').toUpperCase();
        if (NON_BILLABLE.has(c) || (0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
            continue;
        map.set(a.employeeId, (map.get(a.employeeId) || 0) + (a.hours ?? 8));
    }
    return map;
}
function shiftAppliesOnDay(shift, dayLetter) {
    if (!Array.isArray(shift.days) || shift.days.length === 0)
        return true;
    return shift.days.includes(dayLetter);
}
function dailySlotLimit(pos, shiftCode, dayLetter) {
    if (!(0, vplan_positions_1.isPositionActiveOnDay)(pos, dayLetter))
        return 0;
    const qty = Math.max(1, Number(pos.qty) || 1);
    const shift = (pos.shifts || []).find((s) => String(s.code || '').toUpperCase() === shiftCode);
    if (!shift || !shiftAppliesOnDay(shift, dayLetter))
        return 0;
    return qty;
}
function rebalanceHoursTowardSla(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
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
        if (!NON_BILLABLE.has(c))
            billable += a.hours ?? 8;
    }
    if (opts.slaVendidas <= 0 || billable >= opts.slaVendidas - tolerance) {
        return { draft: opts.draft, log, hoursAdded: 0 };
    }
    const hoursByEmp = countBillableByEmp(assignments);
    const daySlotCount = new Map();
    for (const a of assignments) {
        const posName = String(a.positionName || opts.defaultPositionByEmp[a.employeeId] || '').trim();
        const code = String(a.code || '').toUpperCase();
        if (!posName || !WORK_CODES.has(code))
            continue;
        const k = slotKey(a.dateStr, posName, (0, vplan_sla_enforce_1.normBandCode)(code));
        daySlotCount.set(k, (daySlotCount.get(k) || 0) + 1);
    }
    let hoursAdded = 0;
    for (const { dateStr, dayLetter } of opts.dateStrs) {
        if (billable >= opts.slaVendidas - tolerance)
            break;
        for (const pos of opts.positions) {
            if (billable >= opts.slaVendidas - tolerance)
                break;
            const posName = pos.positionName;
            for (const shift of (0, vplan_positions_1.shiftsForCycle)(pos, opts.cycle)) {
                const shiftCode = String(shift.code || '').toUpperCase();
                if (!shiftCode || NON_BILLABLE.has(shiftCode))
                    continue;
                if (!shiftAppliesOnDay(shift, dayLetter))
                    continue;
                const limit = dailySlotLimit(pos, shiftCode, dayLetter);
                if (limit <= 0)
                    continue;
                const band = (0, vplan_sla_enforce_1.normBandCode)(shiftCode);
                const key = slotKey(dateStr, posName, band);
                let used = daySlotCount.get(key) || 0;
                while (used < limit && billable < opts.slaVendidas - tolerance) {
                    const candidates = assignments
                        .map((a, i) => ({ a, i }))
                        .filter(({ a }) => {
                        if (a.dateStr !== dateStr)
                            return false;
                        if (!opts.employeeIds.includes(a.employeeId))
                            return false;
                        if ((0, vplan_positions_1.isVirtualEmployeeId)(a.employeeId))
                            return false;
                        if (opts.protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(a.employeeId, dateStr)))
                            return false;
                        const c = String(a.code || '').toUpperCase();
                        if (!FRANCO_POOL.has(c))
                            return false;
                        const empH = hoursByEmp.get(a.employeeId) || 0;
                        if (empH >= targetPerEmp + 4)
                            return false;
                        const cct = (0, vplan_cct_enforce_1.wouldExceedCctWorkStreak)({
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
                        if (xPos !== yPos)
                            return xPos - yPos;
                        return xh - yh;
                    });
                    const pick = candidates[0];
                    if (!pick)
                        break;
                    const h = (0, vplan_positions_1.shiftBandHours)(shift);
                    assignments[pick.i] = {
                        ...assignments[pick.i],
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
//# sourceMappingURL=vplan.hour-rebalance.js.map