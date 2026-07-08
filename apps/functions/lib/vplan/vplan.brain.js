"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateVplanBrainMandates = evaluateVplanBrainMandates;
exports.applyLightPositionTagFixes = applyLightPositionTagFixes;
exports.runBrainMandateRepair = runBrainMandateRepair;
const autoScheduleEngine_1 = require("../scheduling/autoScheduleEngine");
const planning_rules_service_1 = require("../planning/planning-rules.service");
const vplan_brain_model_1 = require("./vplan.brain-model");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
const vplan_engine_bridge_1 = require("./vplan.engine-bridge");
const vplan_coverage_views_1 = require("./vplan.coverage-views");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'EN', 'RO', 'RON']);
function mandateCiclo6x2(opts) {
    const maxWork = (0, vplan_brain_model_1.maxWorkDaysForPlanningCycle)(opts.cycle, opts.rules);
    const cctStreaks = (0, vplan_cct_enforce_1.detectCctStreakViolations)({
        draft: opts.draft,
        dateStrs: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.snapshot.previousMonthAssignments,
        rules: opts.rules,
    });
    let crossMonth = [];
    if (opts.strategy.modes.useTrailing && opts.prevMonthLastDate && opts.monthFirstDate) {
        crossMonth = (0, vplan_cycle_continuity_1.detectCrossMonthContinuityViolations)({
            draft: opts.draft,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            prevMonthLastDate: opts.prevMonthLastDate,
            monthFirstDate: opts.monthFirstDate,
            prevPlanningState: opts.prevPlanningState,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            cycle: opts.strategy.cycle,
        });
    }
    const softFt = cctStreaks.filter((v) => v.workDays === maxWork + 1);
    const hardStreaks = cctStreaks.filter((v) => v.workDays > maxWork + 1);
    const ok = hardStreaks.length === 0 && crossMonth.length === 0;
    const parts = [];
    if (hardStreaks.length > 0) {
        parts.push(`${hardStreaks.length} racha(s) >${maxWork + 1}d CCT`);
    }
    if (softFt.length > 0) {
        parts.push(`${softFt.length} FT (×${maxWork + 1})`);
    }
    if (crossMonth.length > 0) {
        parts.push(`${crossMonth.length} ruptura(s) cross-month`);
    }
    return {
        status: {
            key: 'CICLO_6X2',
            label: 'Ciclo 6+2 + racha',
            ok,
            summary: ok
                ? (softFt.length > 0
                    ? `6+2 OK · ${softFt.length} franco(s) trabajado(s)`
                    : `6+2 OK (máx ${maxWork} trab consecutivos)`)
                : parts.join(' · '),
        },
        crossMonthViolations: crossMonth.length,
        inMonthStreakViolations: hardStreaks.length,
    };
}
function mandateHorasVendidas(billable, slaVendidas, tolerance, motorClosed) {
    const target = slaVendidas > 0 ? slaVendidas : 0;
    const gap = target > 0 ? target - billable : 0;
    const ok = target <= 0
        || billable >= target - tolerance
        || (motorClosed && gap <= tolerance);
    return {
        key: 'HORAS_VENDIDAS',
        label: 'Horas vendidas',
        ok,
        summary: target > 0
            ? (ok ? `${billable}h / ${target}h SLA` : `Faltan ${Math.max(0, gap)}h (${billable}h / ${target}h)`)
            : `${billable}h facturables`,
    };
}
function mandateCobertura(uncovered, covered, total) {
    const ok = uncovered <= 0 && total > 0;
    return {
        key: 'COBERTURA_OBJETIVO',
        label: 'Cobertura objetivo',
        ok,
        summary: ok
            ? `${covered}/${total} slots cubiertos`
            : `${uncovered} slot(s) descubierto(s) (${covered}/${total})`,
    };
}
function planCoverageLadder(opts) {
    const recs = [];
    const hasRet = (opts.supply?.employees?.length ?? 0) > 0;
    const hasPool = (opts.supply?.employeeCount ?? 0) > 0;
    for (const [dateStr, gaps] of Object.entries(opts.uncoveredByDay)) {
        for (const gap of gaps) {
            for (let m = 0; m < gap.missing; m++) {
                const step = (0, vplan_brain_model_1.recommendCoverageLadderStep)({
                    hourHeadroom: opts.hourHeadroom,
                    hasRetAvailable: hasRet,
                    hasUnassignedPool: hasPool,
                });
                const ladderIdx = step === 'REFUERZO_4X2_OBJETIVO' ? 2
                    : step === 'SIN_TURNO_OBJETIVO' ? 3
                        : step === 'RET_OBJETIVO' ? 4
                            : step === 'FT_FRANCO_TRABAJADO' ? 5
                                : 1;
                recs.push({
                    dateStr,
                    positionName: gap.positionName,
                    shiftCode: gap.shiftCode,
                    ladderStep: step,
                    stepNumber: ladderIdx,
                    message: (0, vplan_brain_model_1.ladderMessage)(step, dateStr, gap.positionName, gap.shiftCode),
                });
            }
        }
    }
    return recs;
}
function countTrailingEmployees(draft) {
    const protectedKeys = draft.stats?.openingProtectedCells;
    if (protectedKeys?.length) {
        const emps = new Set(protectedKeys.map((k) => k.split('_')[0]).filter(Boolean));
        return emps.size;
    }
    return 0;
}
function evaluateVplanBrainMandates(opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.planningRules ?? null);
    const tolerance = rules.slaHoursTolerance ?? 8;
    const dateStrList = opts.dateStrList?.length
        ? opts.dateStrList
        : [...new Set(opts.draft.assignments.map((a) => a.dateStr))].sort();
    const ctx = (0, vplan_engine_bridge_1.buildEngineContext)({
        snapshot: opts.snapshot,
        planningState: opts.planningState,
        prevPlanningState: opts.prevPlanningState,
        strategy: opts.strategy,
    });
    const engineAssignments = (0, vplan_coverage_views_1.engineAssignmentsFromDraft)(opts.draft.assignments);
    const coverage = (0, autoScheduleEngine_1.verifyCoverage)(ctx, engineAssignments);
    const ciclo = mandateCiclo6x2({
        strategy: opts.strategy,
        draft: opts.draft,
        snapshot: opts.snapshot,
        prevPlanningState: opts.prevPlanningState,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        prevMonthLastDate: opts.prevMonthLastDate,
        monthFirstDate: opts.monthFirstDate,
        dateStrList,
        cycle: opts.strategy.cycle,
        rules,
    });
    const cobertura = mandateCobertura(coverage.uncoveredSlots, coverage.coveredSlots, coverage.totalSlots);
    const horas = mandateHorasVendidas(Math.round(coverage.billableHours), coverage.slaVendidas, tolerance, opts.draft.stats?.slaHoursClosed === true);
    const offerHours = (0, vplan_brain_model_1.buildFeasibilityHourOffer)(opts.demand, opts.supply, opts.feasibility);
    const employeeCount = opts.supply?.employeeCount ?? opts.snapshot.employees.length;
    const hourHeadroom = (0, vplan_brain_model_1.computeHourHeadroom)({
        slaVendidas: coverage.slaVendidas,
        billableHours: Math.round(coverage.billableHours),
        offerHours,
        tolerance,
        employeeCount,
        targetAvgHoursPerEmployee: rules.targetAvgHoursPerEmployee,
    });
    const planningLayers = (0, vplan_brain_model_1.describePlanningLayers)({
        objectiveCycle: opts.strategy.cycle || vplan_brain_model_1.OBJECTIVE_CYCLE_DEFAULT,
        useTrailing: !!opts.strategy.modes.useTrailing,
        trailingEmployeeCount: countTrailingEmployees(opts.draft),
        hourHeadroom,
    });
    const coverageLadder = planCoverageLadder({
        uncoveredByDay: coverage.uncoveredByDay ?? {},
        hourHeadroom,
        supply: opts.supply,
    });
    const mandates = [ciclo.status, cobertura, horas];
    const mandatesOk = mandates.filter((m) => m.ok).length;
    const allMandatesOk = mandatesOk === mandates.length;
    const repairTargets = mandates.filter((m) => !m.ok).map((m) => m.key);
    let action;
    let preserveGeneration = false;
    let summary;
    if (allMandatesOk) {
        action = 'skip';
        preserveGeneration = true;
        summary = `3/3 mandatos OK — preservar generación`;
    }
    else if (opts.mode === 'GREENFIELD'
        || opts.mode === 'MIGRATE_CYCLE'
        || opts.mode === 'REBALANCE_HOURS'
        || opts.mode === 'RESTORE'
        || opts.mode === 'REPLAN_ABSENCES') {
        action = 'solver_full';
        summary = `${mandatesOk}/3 mandatos · modo ${opts.mode} → solver completo`;
    }
    else {
        action = 'preserve';
        preserveGeneration = opts.mode === 'CONTINUE';
        const ladderNote = coverageLadder.length > 0
            ? ` · escalera: ${coverageLadder.length} hueco(s)`
            : '';
        summary = `${mandatesOk}/3 mandatos · preservar + plan contingencia: ${repairTargets.join(', ')}${ladderNote}`;
    }
    return {
        mandates,
        mandatesOk,
        mandatesTotal: mandates.length,
        allMandatesOk,
        action,
        summary,
        preserveGeneration,
        repairTargets,
        planningLayers,
        hourHeadroom,
        coverageLadder,
        inMonthStreakViolations: ciclo.inMonthStreakViolations,
        crossMonthViolations: ciclo.crossMonthViolations,
    };
}
function applyLightPositionTagFixes(opts) {
    const log = [];
    const assignments = opts.draft.assignments.map((a) => ({ ...a }));
    for (let i = 0; i < assignments.length; i++) {
        const cell = assignments[i];
        const code = String(cell.code || '').toUpperCase();
        if (!WORK_CODES.has(code))
            continue;
        const key = `${cell.employeeId}_${cell.dateStr}`;
        if (opts.protectedCells?.has(key))
            continue;
        const expected = String(opts.defaultPositionByEmp[cell.employeeId] || '').trim();
        if (!expected)
            continue;
        const tagged = String(cell.positionName || '').trim();
        if (tagged === expected)
            continue;
        assignments[i] = { ...cell, positionName: expected };
        log.push({
            code: 'POSITION_TAG',
            message: tagged
                ? `Tag ${(0, vplan_sla_enforce_1.normBandCode)(code)}: ${tagged} → ${expected} (${cell.dateStr})`
                : `Tag ${(0, vplan_sla_enforce_1.normBandCode)(code)} → ${expected} (${cell.dateStr})`,
            employeeId: cell.employeeId,
            dateStr: cell.dateStr,
        });
    }
    return { draft: { ...opts.draft, assignments }, log };
}
function runBrainMandateRepair(opts) {
    const log = [{ code: 'BRAIN_PRESERVE', message: opts.brain.summary }];
    let draft = opts.draft;
    if (opts.brain.repairTargets.includes('CICLO_6X2') && opts.strategy.modes.useTrailing) {
        const patched = (0, vplan_cycle_continuity_1.patchMonthOpeningContinuity)({
            draft,
            previousMonthAssignments: opts.snapshot.previousMonthAssignments,
            prevMonthLastDate: opts.prevMonthLastDate,
            monthFirstDate: opts.monthFirstDate,
            prevPlanningState: opts.prevPlanningState,
            positions: opts.snapshot.positions,
            defaultPositionByEmp: opts.defaultPositionByEmp,
            defaultShiftByEmp: opts.defaultShiftByEmp,
            cycle: opts.cycle,
            useTrailing: true,
        });
        draft = patched.draft;
        log.push(...patched.log);
    }
    for (const layer of opts.brain.planningLayers) {
        log.push({
            code: 'BRAIN_LAYER',
            message: `[${layer.key}] ${layer.value} — ${layer.notes}`,
        });
    }
    if (opts.brain.hourHeadroom.assignmentGapNotHeadcount) {
        log.push({
            code: 'BRAIN_CAPACITY',
            message: opts.brain.hourHeadroom.summary,
        });
    }
    log.push({
        code: 'BRAIN_HEADROOM',
        message: opts.brain.hourHeadroom.summary,
    });
    for (const rec of opts.brain.coverageLadder) {
        log.push({
            code: rec.ladderStep === 'FT_FRANCO_TRABAJADO' ? 'NEEDS_REINFORCEMENT' : 'BRAIN_LADDER',
            message: `[paso ${rec.stepNumber}] ${rec.message}`,
            dateStr: rec.dateStr,
        });
    }
    if (opts.brain.inMonthStreakViolations > 0) {
        log.push({
            code: 'CICLO_6X2_VIOLATION',
            message: `${opts.brain.inMonthStreakViolations} racha(s) >6d — no forzar 7º día; revisar fase 5`,
        });
    }
    const tagged = applyLightPositionTagFixes({
        draft,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        protectedCells: opts.protectedCells,
    });
    draft = tagged.draft;
    log.push(...tagged.log);
    return { draft, log };
}
//# sourceMappingURL=vplan.brain.js.map