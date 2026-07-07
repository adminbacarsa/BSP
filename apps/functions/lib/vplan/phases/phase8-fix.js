"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanDeterministicFixer = runVplanDeterministicFixer;
const vplan_brain_1 = require("../vplan.brain");
const vplan_coverage_solver_1 = require("../vplan.coverage-solver");
const vplan_cycle_continuity_1 = require("../vplan.cycle-continuity");
const planning_rules_service_1 = require("../../planning/planning-rules.service");
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
function applyCctHourCap(draft, assignments, maxHours, protectedCells) {
    const log = [];
    const hoursByEmp = {};
    for (const a of assignments) {
        const code = a.code.toUpperCase();
        if (!BILLABLE.has(code))
            continue;
        hoursByEmp[a.employeeId] = (hoursByEmp[a.employeeId] || 0) + (a.hours ?? 8);
    }
    const sorted = [...assignments].sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    const indexByKey = new Map();
    assignments.forEach((a, i) => indexByKey.set(`${a.employeeId}_${a.dateStr}`, i));
    const next = assignments.map((a) => ({ ...a }));
    for (const a of sorted) {
        const code = a.code.toUpperCase();
        if (!BILLABLE.has(code))
            continue;
        if (protectedCells?.has((0, vplan_cycle_continuity_1.protectedCellKey)(a.employeeId, a.dateStr)))
            continue;
        const used = hoursByEmp[a.employeeId] || 0;
        if (used <= maxHours)
            continue;
        const idx = indexByKey.get(`${a.employeeId}_${a.dateStr}`);
        if (idx === undefined)
            continue;
        hoursByEmp[a.employeeId] = used - (a.hours ?? 8);
        next[idx] = { ...next[idx], code: 'F', hours: 0, positionName: '' };
        log.push({
            code: 'CCT_CAP',
            message: `Turno ${code} → F por tope ${maxHours}h ciclo`,
            employeeId: a.employeeId,
            dateStr: a.dateStr,
        });
    }
    return { assignments: next, log };
}
function runSolverFullFixer(draft, dateStrs, opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.planningRules ?? null);
    const log = [];
    const cycle = opts.cycle ?? (draft.sourceEngine?.includes('4+2') ? '4+2' : '6+2');
    let coverageAudit;
    const protectedCells = opts.protectedCells;
    let assignments = draft.assignments.map((a) => ({ ...a }));
    if (opts.demand
        && opts.positions?.length
        && opts.dateMeta?.length
        && dateStrs.length
        && opts.defaultPositionByEmp) {
        const solved = (0, vplan_coverage_solver_1.runCoverageSolverLoop)({
            draft: { ...draft, assignments },
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            dateStrs: opts.dateMeta,
            dateStrList: dateStrs,
            cycle,
            previousMonthAssignments: opts.previousMonthAssignments,
            employeeNames: opts.employeeNames,
            maxIterations: rules.solverMaxIterations,
            rules,
            protectedCells,
        });
        assignments = solved.draft.assignments;
        log.push(...solved.log);
        coverageAudit = solved.audit;
    }
    const capped = applyCctHourCap(draft, assignments, rules.cctMaxBillableHours, protectedCells);
    assignments = capped.assignments;
    log.push(...capped.log);
    return {
        draft: { ...draft, assignments },
        log,
        coverageAudit,
    };
}
function runVplanDeterministicFixer(draft, dateStrs, opts) {
    const action = opts?.action ?? opts?.brainReport?.action ?? 'solver_full';
    const summary = opts?.brainReport?.summary ?? action;
    const isPreserve = action === 'preserve' || action === 'mandate_repair';
    if (action === 'skip') {
        return {
            draft,
            log: [{ code: 'BRAIN_SKIP', message: summary }],
            action,
        };
    }
    if (isPreserve && opts?.brainReport && opts.demand && opts.positions && opts.dateMeta && opts.defaultPositionByEmp && opts.snapshot && opts.prevPlanningState && opts.strategy && opts.prevMonthLastDate && opts.monthFirstDate) {
        const repaired = (0, vplan_brain_1.runBrainMandateRepair)({
            brain: opts.brainReport,
            draft,
            dateStrList: dateStrs ?? [],
            dateMeta: opts.dateMeta,
            demand: opts.demand,
            positions: opts.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            defaultShiftByEmp: opts.defaultShiftByEmp ?? {},
            cycle: opts.cycle ?? opts.strategy.cycle,
            strategy: opts.strategy,
            snapshot: opts.snapshot,
            prevPlanningState: opts.prevPlanningState,
            prevMonthLastDate: opts.prevMonthLastDate,
            monthFirstDate: opts.monthFirstDate,
            previousMonthAssignments: opts.previousMonthAssignments,
            employeeNames: opts.employeeNames,
            planningRules: opts.planningRules,
            protectedCells: opts.protectedCells,
        });
        return {
            draft: repaired.draft,
            log: repaired.log,
            coverageAudit: repaired.coverageAudit,
            action,
        };
    }
    if (isPreserve && opts?.defaultPositionByEmp) {
        const tagged = (0, vplan_brain_1.applyLightPositionTagFixes)({
            draft,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            protectedCells: opts.protectedCells,
        });
        return {
            draft: tagged.draft,
            log: [{ code: 'BRAIN_REPAIR_FALLBACK', message: summary }, ...tagged.log],
            action,
        };
    }
    const full = runSolverFullFixer(draft, dateStrs ?? [], opts ?? {});
    return {
        ...full,
        log: [{ code: 'BRAIN_SOLVER_FULL', message: summary }, ...full.log],
        action: 'solver_full',
    };
}
//# sourceMappingURL=phase8-fix.js.map