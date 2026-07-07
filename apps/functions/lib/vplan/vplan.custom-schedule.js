"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceCustomPositionSchedules = enforceCustomPositionSchedules;
exports.detectOverlongWorkStreaks = detectOverlongWorkStreaks;
exports.detectConsecutiveBillableHoursViolations = detectConsecutiveBillableHoursViolations;
const vplan_positions_1 = require("./vplan.positions");
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
function assignmentKey(empId, dateStr) {
    return `${empId}_${dateStr}`;
}
function enforceCustomPositionSchedules(opts) {
    const log = [];
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const customPositions = opts.positions.filter((p) => (0, vplan_positions_1.isCustomFixedShiftPosition)(p));
    if (customPositions.length === 0) {
        return { draft: opts.draft, log };
    }
    const empToPos = (0, vplan_sla_enforce_1.resolvePositionAssignees)({
        defaultPositionByEmp: opts.defaultPositionByEmp,
        positions: opts.positions,
        draftAssignments: opts.draft.assignments,
        onlyCustom: true,
    });
    const indexByKey = new Map();
    const assignments = opts.draft.assignments.map((a, i) => {
        indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i);
        return { ...a };
    });
    for (const [empId, posName] of empToPos) {
        if (opts.openingSlotByEmp?.[empId] !== undefined)
            continue;
        const pos = posByName.get(posName);
        if (!pos || !(0, vplan_positions_1.isCustomFixedShiftPosition)(pos))
            continue;
        const shiftCode = (0, vplan_positions_1.primaryShiftCode)(pos);
        const hours = (0, vplan_positions_1.shiftBandHours)(pos.shifts[0] || { code: shiftCode });
        for (const { dateStr, dayLetter } of opts.dateStrs) {
            if (opts.absences?.[empId]?.has(dateStr))
                continue;
            const key = assignmentKey(empId, dateStr);
            let idx = indexByKey.get(key);
            const active = (0, vplan_positions_1.isPositionActiveOnDay)(pos, dayLetter);
            const expectedCode = active ? shiftCode : 'F';
            const expectedHours = active ? hours : 0;
            const expectedPos = active ? posName : '';
            if (idx === undefined) {
                assignments.push({
                    employeeId: empId,
                    dateStr,
                    code: expectedCode,
                    positionName: expectedPos,
                    hours: expectedHours,
                });
                idx = assignments.length - 1;
                indexByKey.set(key, idx);
                log.push({
                    code: 'CUSTOM_LV',
                    message: `Creado ${expectedCode} (${posName}, ${dayLetter})`,
                    employeeId: empId,
                    dateStr,
                });
                continue;
            }
            const current = assignments[idx];
            if (current.code.toUpperCase() === expectedCode
                && (current.positionName || '') === expectedPos)
                continue;
            log.push({
                code: 'CUSTOM_LV',
                message: `${current.code} → ${expectedCode} (${posName}, ${dayLetter})`,
                employeeId: empId,
                dateStr,
            });
            assignments[idx] = {
                ...current,
                code: expectedCode,
                positionName: expectedPos,
                hours: expectedHours,
            };
        }
    }
    return {
        draft: { ...opts.draft, assignments },
        log,
    };
}
function detectOverlongWorkStreaks(draft, dateStrs, maxWorkDays = 6) {
    const violations = [];
    const byEmp = new Map();
    for (const a of draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
    const WORK = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO']);
    for (const [empId, byDate] of byEmp) {
        let streakStart = '';
        let streakLen = 0;
        for (const dateStr of dateStrs) {
            const a = byDate.get(dateStr);
            const code = a?.code?.toUpperCase() || '';
            const isWork = WORK.has(code);
            const isFranco = FRANCO.has(code);
            if (isWork) {
                if (streakLen === 0)
                    streakStart = dateStr;
                streakLen += 1;
            }
            else if (isFranco || !code) {
                if (streakLen > maxWorkDays) {
                    violations.push({
                        employeeId: empId,
                        band: byDate.get(streakStart)?.code?.toUpperCase() || '?',
                        fromDate: streakStart,
                        toDate: dateStrs[dateStrs.indexOf(dateStr) - 1] || dateStr,
                        days: streakLen,
                    });
                }
                streakLen = 0;
                streakStart = '';
            }
            if (dateStr === dateStrs[dateStrs.length - 1] && streakLen > maxWorkDays) {
                violations.push({
                    employeeId: empId,
                    band: byDate.get(streakStart)?.code?.toUpperCase() || '?',
                    fromDate: streakStart,
                    toDate: dateStr,
                    days: streakLen,
                });
            }
        }
    }
    return violations;
}
const REST_BREAK = new Set(['F', 'FF', 'FP', 'FT']);
const NON_BILLABLE_BREAK = new Set(['RET', 'R', 'V', 'L', 'A', 'E', 'AA', 'PG']);
function detectConsecutiveBillableHoursViolations(draft, dateStrs, maxHours) {
    const violations = [];
    const byEmp = new Map();
    for (const a of draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    for (const [empId, byDate] of byEmp) {
        let streakStart = '';
        let streakHours = 0;
        const flushIfOver = (toDate) => {
            if (streakHours > maxHours) {
                violations.push({
                    employeeId: empId,
                    fromDate: streakStart,
                    toDate,
                    hours: streakHours,
                });
            }
        };
        const resetStreak = () => {
            streakStart = '';
            streakHours = 0;
        };
        for (const dateStr of dateStrs) {
            const a = byDate.get(dateStr);
            const code = a?.code?.toUpperCase() || '';
            const billable = a?.hours ?? (0, vplan_cycle_templates_1.billableHoursForCode)(code);
            if (billable > 0 && !REST_BREAK.has(code) && !NON_BILLABLE_BREAK.has(code)) {
                if (streakHours === 0)
                    streakStart = dateStr;
                streakHours += billable;
                flushIfOver(dateStr);
            }
            else if (REST_BREAK.has(code) || billable <= 0 || NON_BILLABLE_BREAK.has(code)) {
                resetStreak();
            }
        }
        if (streakHours > maxHours && streakStart) {
            const lastDate = dateStrs[dateStrs.length - 1] ?? streakStart;
            violations.push({
                employeeId: empId,
                fromDate: streakStart,
                toDate: lastDate,
                hours: streakHours,
            });
        }
    }
    return violations;
}
//# sourceMappingURL=vplan.custom-schedule.js.map