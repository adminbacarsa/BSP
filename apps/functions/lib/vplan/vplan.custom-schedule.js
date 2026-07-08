"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enforceCustomPositionSchedules = enforceCustomPositionSchedules;
exports.detectOverlongWorkStreaks = detectOverlongWorkStreaks;
exports.detectConsecutiveBillableHoursViolations = detectConsecutiveBillableHoursViolations;
exports.isCustomEmployeeCrossAssignable = isCustomEmployeeCrossAssignable;
exports.computeCustomScheduleProtectedCells = computeCustomScheduleProtectedCells;
exports.detectCustomScheduleViolations = detectCustomScheduleViolations;
exports.detectOverlongRestStreaks = detectOverlongRestStreaks;
exports.enforceMaxRestStreak = enforceMaxRestStreak;
const planning_rules_defaults_1 = require("../planning/planning-rules.defaults");
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_coverage_audit_1 = require("./vplan.coverage-audit");
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const vplan_positions_1 = require("./vplan.positions");
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
const FRANCO_SET = new Set(['F', 'FF', 'FP', 'FT']);
function isFrancoCode(code) {
    return FRANCO_SET.has(code.toUpperCase());
}
function isCustomEmployeeCrossAssignable(opts) {
    const posName = String(opts.defaultPositionByEmp[opts.empId] || '').trim();
    if (!posName)
        return true;
    const pos = opts.positions.find((p) => p.positionName === posName);
    if (!pos)
        return true;
    return !(0, vplan_positions_1.isCustomFixedShiftPosition)(pos);
}
function computeCustomScheduleProtectedCells(opts) {
    const protectedCells = new Set();
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const empToPos = (0, vplan_sla_enforce_1.resolvePositionAssignees)({
        defaultPositionByEmp: opts.defaultPositionByEmp,
        positions: opts.positions,
        draftAssignments: opts.draftAssignments,
        onlyCustom: true,
    });
    for (const [empId, posName] of empToPos) {
        const pos = posByName.get(posName);
        if (!pos || !(0, vplan_positions_1.isCustomFixedShiftPosition)(pos))
            continue;
        for (const { dateStr, dayLetter } of opts.dateStrs) {
            if (!(0, vplan_positions_1.isPositionActiveOnDay)(pos, dayLetter)) {
                protectedCells.add((0, vplan_cycle_continuity_1.protectedCellKey)(empId, dateStr));
            }
        }
    }
    return protectedCells;
}
function detectCustomScheduleViolations(opts) {
    const violations = [];
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const empToPos = (0, vplan_sla_enforce_1.resolvePositionAssignees)({
        defaultPositionByEmp: opts.defaultPositionByEmp,
        positions: opts.positions,
        draftAssignments: opts.draft.assignments,
        onlyCustom: true,
    });
    const byEmp = new Map();
    for (const a of opts.draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    for (const [empId, posName] of empToPos) {
        const pos = posByName.get(posName);
        if (!pos || !(0, vplan_positions_1.isCustomFixedShiftPosition)(pos))
            continue;
        const shiftCode = (0, vplan_positions_1.primaryShiftCode)(pos);
        for (const { dateStr, dayLetter } of opts.dateStrs) {
            const active = (0, vplan_positions_1.isPositionActiveOnDay)(pos, dayLetter);
            const expectedCode = active ? shiftCode : 'F';
            const cell = byEmp.get(empId)?.get(dateStr);
            const actualCode = String(cell?.code || 'F').toUpperCase();
            if (actualCode === expectedCode)
                continue;
            if (!active && isFrancoCode(actualCode) && actualCode !== 'F')
                continue;
            violations.push({
                employeeId: empId,
                dateStr,
                expectedCode,
                actualCode,
                positionName: posName,
            });
        }
    }
    return violations;
}
function detectOverlongRestStreaks(draft, dateStrs, cycle, previousMonthAssignments, rules) {
    const resolved = (0, planning_rules_service_1.resolvePlanningRules)(rules ?? null);
    const maxRest = (0, planning_rules_defaults_1.restDaysForCycle)(cycle, resolved);
    const violations = [];
    const byEmp = new Map();
    for (const a of draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    const empIds = new Set(draft.assignments.map((a) => a.employeeId));
    for (const empId of empIds) {
        let restRun = (0, vplan_cct_enforce_1.trailingRestFromPrevMonth)(previousMonthAssignments, empId);
        let streakStart = '';
        for (const dateStr of dateStrs) {
            const code = String(byEmp.get(empId)?.get(dateStr)?.code || 'F').toUpperCase();
            if (isFrancoCode(code) || !code) {
                if (restRun === 0)
                    streakStart = dateStr;
                restRun += 1;
                if (restRun > maxRest) {
                    violations.push({
                        employeeId: empId,
                        fromDate: streakStart,
                        toDate: dateStr,
                        restDays: restRun,
                        maxRest,
                    });
                }
            }
            else {
                restRun = 0;
                streakStart = '';
            }
        }
    }
    return violations;
}
function enforceMaxRestStreak(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const maxRest = (0, planning_rules_defaults_1.restDaysForCycle)(opts.cycle, rules);
    const posByName = new Map(opts.positions.map((p) => [p.positionName, p]));
    const customEmpIds = new Set((0, vplan_sla_enforce_1.resolvePositionAssignees)({
        defaultPositionByEmp: opts.defaultPositionByEmp,
        positions: opts.positions,
        draftAssignments: opts.draft.assignments,
        onlyCustom: true,
    }).keys());
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    const indexByKey = new Map();
    assignments.forEach((a, i) => indexByKey.set(assignmentKey(a.employeeId, a.dateStr), i));
    const shiftCandidatesFor = (empId) => {
        const preferred = String(opts.defaultShiftByEmp?.[empId] || '').toUpperCase();
        const pool = preferred ? [preferred, 'M', 'T', 'N'] : ['M', 'T', 'N'];
        return [...new Set(pool.filter((c) => (0, vplan_cycle_templates_1.isCycleWorkCode)(c, opts.cycle)))];
    };
    const empIds = new Set(assignments.map((a) => a.employeeId));
    for (const empId of empIds) {
        if (customEmpIds.has(empId))
            continue;
        let restRun = (0, vplan_cct_enforce_1.trailingRestFromPrevMonth)(opts.previousMonthAssignments, empId);
        for (const dateStr of opts.dateStrs) {
            const key = assignmentKey(empId, dateStr);
            const idx = indexByKey.get(key);
            if (idx === undefined)
                continue;
            const cell = assignments[idx];
            const code = String(cell.code || 'F').toUpperCase();
            if (!isFrancoCode(code)) {
                restRun = 0;
                continue;
            }
            restRun += 1;
            if (restRun <= maxRest)
                continue;
            if (opts.protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(empId, dateStr)))
                continue;
            const defaultPos = String(opts.defaultPositionByEmp[empId] || '').trim();
            const pos = defaultPos ? posByName.get(defaultPos) : undefined;
            if (pos && (0, vplan_positions_1.isCustomFixedShiftPosition)(pos))
                continue;
            let picked = null;
            for (const shiftCode of shiftCandidatesFor(empId)) {
                const evalResult = (0, vplan_coverage_audit_1.evaluateCoverageCandidate)({
                    empId,
                    dateStr,
                    shiftCode,
                    assignments,
                    dateStrs: opts.dateStrs,
                    cycle: opts.cycle,
                    previousMonthAssignments: opts.previousMonthAssignments,
                    rules,
                });
                if (evalResult.canAssign) {
                    picked = shiftCode;
                    break;
                }
            }
            if (!picked)
                continue;
            assignments[idx] = {
                ...cell,
                code: picked,
                positionName: defaultPos,
                hours: (0, vplan_cycle_templates_1.billableHoursForCode)(picked),
            };
            log.push({
                code: 'CCT_TRIM_REST',
                message: `F → ${picked} (racha F>${maxRest}, ${opts.cycle})`,
                employeeId: empId,
                dateStr,
            });
            restRun = 0;
        }
    }
    return { draft: { ...opts.draft, assignments }, log };
}
//# sourceMappingURL=vplan.custom-schedule.js.map