"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trailingWorkFromPrevMonth = trailingWorkFromPrevMonth;
exports.wouldExceedCctWorkStreak = wouldExceedCctWorkStreak;
exports.enforceCctWorkRestPattern = enforceCctWorkRestPattern;
exports.detectCctStreakViolations = detectCctStreakViolations;
const planning_rules_defaults_1 = require("../planning/planning-rules.defaults");
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
const ABSENCE = new Set(['V', 'L', 'E', 'A', 'PG', 'AA']);
function isFranco(code) {
    return FRANCO.has(code.toUpperCase());
}
function isAbsence(code) {
    return ABSENCE.has(code.toUpperCase());
}
function assignmentKey(empId, dateStr) {
    return `${empId}_${dateStr}`;
}
function trailingWorkFromPrevMonth(prev, empId, cycle) {
    if (!prev?.length)
        return 0;
    const rows = prev
        .filter((a) => a.employeeId === empId)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    let run = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
        const c = String(rows[i]?.code || '').toUpperCase();
        if (isFranco(c) || isAbsence(c))
            break;
        if ((0, vplan_cycle_templates_1.isCycleWorkCode)(c, cycle))
            run += 1;
        else
            break;
    }
    return run;
}
function trailingRestFromPrevMonth(prev, empId) {
    if (!prev?.length)
        return 0;
    const rows = prev
        .filter((a) => a.employeeId === empId)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    let run = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
        const c = String(rows[i]?.code || '').toUpperCase();
        if (isFranco(c))
            run += 1;
        else
            break;
    }
    return run;
}
function wouldExceedCctWorkStreak(opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const cycle = opts.cycle;
    const maxWork = (0, planning_rules_defaults_1.workDaysForCycle)(cycle, rules);
    const maxRest = (0, planning_rules_defaults_1.restDaysForCycle)(cycle, rules);
    const code = opts.shiftCode.toUpperCase();
    if (!(0, vplan_cycle_templates_1.isCycleWorkCode)(code, cycle))
        return { ok: true };
    const byDate = new Map();
    for (const a of opts.assignments) {
        if (a.employeeId === opts.empId)
            byDate.set(a.dateStr, a);
    }
    let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, opts.empId, cycle);
    let restPending = 0;
    const prevRest = trailingRestFromPrevMonth(opts.previousMonthAssignments, opts.empId);
    if (workRun >= maxWork) {
        restPending = Math.max(0, maxRest - prevRest);
    }
    for (const d of opts.dateStrs) {
        const cell = d === opts.dateStr
            ? { code, positionName: '', employeeId: opts.empId, dateStr: d }
            : byDate.get(d);
        const c = String(cell?.code || '').toUpperCase();
        if (restPending > 0) {
            if (d === opts.dateStr && (0, vplan_cycle_templates_1.isCycleWorkCode)(code, cycle)) {
                return { ok: false, reason: `Bloque descanso CCT (${maxRest}F tras ${maxWork} trab)` };
            }
            if (isFranco(c) || !c)
                restPending -= 1;
            else if ((0, vplan_cycle_templates_1.isCycleWorkCode)(c, cycle))
                restPending = maxRest;
            workRun = 0;
            continue;
        }
        if ((0, vplan_cycle_templates_1.isCycleWorkCode)(c, cycle)) {
            workRun += 1;
            if (workRun > maxWork) {
                if (d === opts.dateStr) {
                    return { ok: false, reason: `Supera racha máx ${maxWork} días trab (${cycle})` };
                }
            }
            if (workRun >= maxWork)
                restPending = maxRest;
        }
        else if (isFranco(c) || isAbsence(c)) {
            workRun = 0;
        }
    }
    return { ok: true };
}
function enforceCctWorkRestPattern(opts) {
    const log = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const cycle = opts.cycle;
    const maxWork = (0, planning_rules_defaults_1.workDaysForCycle)(cycle, rules);
    const maxRest = (0, planning_rules_defaults_1.restDaysForCycle)(cycle, rules);
    const customSkip = opts.skipCustomCodes ?? new Set(['EN', 'RO', 'RON']);
    const byEmp = new Map();
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    assignments.forEach((a, i) => {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, i);
    });
    const empIds = new Set(assignments.map((a) => a.employeeId));
    for (const empId of empIds) {
        let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, empId, cycle);
        let restPending = 0;
        const prevRest = trailingRestFromPrevMonth(opts.previousMonthAssignments, empId);
        if (workRun >= maxWork) {
            restPending = Math.max(0, maxRest - prevRest);
        }
        for (const dateStr of opts.dateStrs) {
            const idxMap = byEmp.get(empId);
            const idx = idxMap?.get(dateStr);
            if (idx === undefined)
                continue;
            const cell = assignments[idx];
            const code = String(cell.code || '').toUpperCase();
            if (customSkip.has(code))
                continue;
            if (restPending > 0) {
                if ((0, vplan_cycle_templates_1.isCycleWorkCode)(code, cycle)) {
                    assignments[idx] = { ...cell, code: 'F', positionName: '', hours: 0 };
                    log.push({
                        code: 'CCT_REST_BLOCK',
                        message: `${code} → F (descanso obligatorio ${maxRest}F tras ${maxWork} trab, ${cycle})`,
                        employeeId: empId,
                        dateStr,
                    });
                }
                restPending -= 1;
                workRun = 0;
                continue;
            }
            if ((0, vplan_cycle_templates_1.isCycleWorkCode)(code, cycle)) {
                workRun += 1;
                if (workRun > maxWork) {
                    assignments[idx] = { ...cell, code: 'F', positionName: '', hours: 0 };
                    log.push({
                        code: 'CCT_MAX_WORK',
                        message: `${code} → F (racha >${maxWork} días, ${cycle})`,
                        employeeId: empId,
                        dateStr,
                    });
                    workRun = 0;
                    restPending = maxRest;
                }
                else if (workRun === maxWork) {
                    restPending = maxRest;
                }
            }
            else if (isFranco(code) || isAbsence(code)) {
                workRun = 0;
            }
        }
    }
    return { draft: { ...opts.draft, assignments }, log };
}
function detectCctStreakViolations(opts) {
    const violations = [];
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.rules ?? null);
    const maxWork = (0, planning_rules_defaults_1.workDaysForCycle)(opts.cycle, rules);
    const maxRest = (0, planning_rules_defaults_1.restDaysForCycle)(opts.cycle, rules);
    const byEmp = new Map();
    for (const a of opts.draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    for (const [empId, byDate] of byEmp) {
        let workRun = trailingWorkFromPrevMonth(opts.previousMonthAssignments, empId, opts.cycle);
        let streakStart = opts.dateStrs[0] ?? '';
        let restPending = 0;
        for (const dateStr of opts.dateStrs) {
            const code = String(byDate.get(dateStr)?.code || '').toUpperCase();
            if (restPending > 0 && (0, vplan_cycle_templates_1.isCycleWorkCode)(code, opts.cycle)) {
                violations.push({
                    employeeId: empId,
                    fromDate: streakStart,
                    toDate: dateStr,
                    workDays: maxWork + 1,
                    expectedRest: maxRest,
                });
                restPending = 0;
            }
            if (restPending > 0 && isFranco(code))
                restPending -= 1;
            else if (restPending > 0 && (0, vplan_cycle_templates_1.isCycleWorkCode)(code, opts.cycle))
                restPending = maxRest;
            else if (restPending > 0)
                restPending = 0;
            if ((0, vplan_cycle_templates_1.isCycleWorkCode)(code, opts.cycle)) {
                if (workRun === 0)
                    streakStart = dateStr;
                workRun += 1;
                if (workRun === maxWork + 1) {
                    violations.push({
                        employeeId: empId,
                        fromDate: streakStart,
                        toDate: dateStr,
                        workDays: workRun,
                        expectedRest: maxRest,
                    });
                }
                if (workRun >= maxWork)
                    restPending = maxRest;
            }
            else if (isFranco(code)) {
                workRun = 0;
            }
        }
    }
    return violations;
}
//# sourceMappingURL=vplan.cct-enforce.js.map