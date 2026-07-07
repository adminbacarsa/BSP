"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanOrchestrator = runVplanOrchestrator;
const vplan_firestore_1 = require("./vplan.firestore");
const planning_rules_service_1 = require("../planning/planning-rules.service");
const planning_rules_defaults_1 = require("../planning/planning-rules.defaults");
const vplan_positions_1 = require("./vplan.positions");
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
const vplan_cycle_continuity_1 = require("./vplan.cycle-continuity");
const vplan_calendar_1 = require("./vplan.calendar");
const vplan_trailing_1 = require("./vplan.trailing");
const phase0_intake_1 = require("./phases/phase0-intake");
const phase1_demand_1 = require("./phases/phase1-demand");
const phase2_supply_1 = require("./phases/phase2-supply");
const phase3_feasibility_1 = require("./phases/phase3-feasibility");
const phase4_strategy_1 = require("./phases/phase4-strategy");
const phase5_generate_1 = require("./phases/phase5-generate");
const phase6_exceptions_1 = require("./phases/phase6-exceptions");
const phase7_verify_1 = require("./phases/phase7-verify");
const phase8_fix_1 = require("./phases/phase8-fix");
const vplan_brain_1 = require("./vplan.brain");
const phase9_optimize_1 = require("./phases/phase9-optimize");
const phase10_deliver_1 = require("./phases/phase10-deliver");
const VPLAN_VERSION = 'VPLAN_0.2';
const PHASE_ORDER = [
    '0_intake',
    '1_demand',
    '2_supply',
    '3_feasibility',
    '4_strategy',
    '5_generate',
    '6_exceptions',
    '7_verify',
    '8_fix',
    '9_optimize',
    '10_deliver',
];
function step(phase, ok, summary, startedAt) {
    return {
        phase,
        ok,
        summary,
        durationMs: startedAt ? Date.now() - startedAt : undefined,
    };
}
function phasesForIntent(intent) {
    const endIndex = {
        intake: 0,
        demand: 1,
        supply: 2,
        feasibility: 3,
        strategy: 4,
        generate: 5,
        exceptions: 6,
        verify: 7,
        fix: 8,
        optimize: 9,
        full: 10,
    };
    const end = endIndex[intent] ?? 10;
    return new Set(PHASE_ORDER.slice(0, end + 1));
}
function hasTrailing(snapshot) {
    return (0, vplan_trailing_1.planningStateHasTrailing)(snapshot.prevPlanningState);
}
async function runVplanOrchestrator(request) {
    const steps = [];
    const intent = request.intent ?? 'full';
    const runPhases = phasesForIntent(intent);
    const validationError = (0, phase0_intake_1.validateVplanRequest)(request);
    if (validationError) {
        return {
            version: VPLAN_VERSION,
            status: 'error',
            message: validationError,
            context: { run: request, steps },
        };
    }
    let snapshot;
    try {
        snapshot = await (0, vplan_firestore_1.loadVplanPlanningSnapshot)({
            empresaId: request.empresaId,
            objectiveId: request.objectiveId,
            year: request.year,
            month: request.month,
            employeeIds: request.employeeIds,
            supplyScope: request.supplyScope,
        });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Error cargando datos Firestore';
        steps.push(step('0_intake', false, msg));
        return {
            version: VPLAN_VERSION,
            status: 'error',
            message: msg,
            context: { run: request, steps },
        };
    }
    const context = { run: request, steps: [] };
    const planningRules = await (0, planning_rules_service_1.loadPlanningRulesForEmpresa)(request.empresaId);
    context.planningRules = planningRules;
    const effectiveCycle = (() => {
        const preferred = request.preferredCycle ?? planningRules.defaultCycle;
        if ((0, planning_rules_defaults_1.enabledCyclesFromRules)(planningRules).includes(preferred)) {
            return preferred;
        }
        return planningRules.defaultCycle;
    })();
    if (runPhases.has('0_intake')) {
        const t0 = Date.now();
        context.intake = (0, phase0_intake_1.buildVplanIntake)(request, snapshot);
        const prevPreview = context.intake.prevMonthPreview;
        const prevSummary = prevPreview
            ? ` · ${prevPreview.assignmentCount} turnos ${prevPreview.prevMonth}/${prevPreview.prevYear} · ${prevPreview.employeesWithTrailing} racha(s)`
            : '';
        steps.push(step('0_intake', true, `${context.intake.objectiveName ?? context.intake.objectiveId} · modo ${context.intake.mode} · ${context.intake.positionCount} puestos · ${context.intake.employeeCount} guardias${prevSummary}`, t0));
    }
    if (runPhases.has('1_demand')) {
        const t1 = Date.now();
        context.demand = (0, phase1_demand_1.buildVplanDemandModel)({
            positions: snapshot.positions,
            days: snapshot.days,
            slaVendidas: snapshot.slaVendidas,
            cycle: effectiveCycle,
        });
        steps.push(step('1_demand', true, `${Math.round(context.demand.monthDemandHours)}h estructura · ${context.demand.slaVendidas}h vendidas`, t1));
    }
    let suggestedHeadcount;
    if (runPhases.has('3_feasibility') && context.demand) {
        const pre = (0, phase3_feasibility_1.buildVplanFeasibilityReport)({
            demand: context.demand,
            supply: (0, phase2_supply_1.buildVplanSupplyModel)({
                employees: snapshot.employees,
                days: snapshot.days,
                absences: snapshot.absences,
                previousMonthStateKey: snapshot.previousMonthStateKey,
                planningRules,
            }),
            positions: snapshot.positions,
            days: snapshot.days,
            preferredCycle: effectiveCycle,
            budgetMode: request.budgetMode,
            planningRules,
        });
        suggestedHeadcount = pre.suggestedHeadcount;
    }
    if (runPhases.has('2_supply')) {
        const t2 = Date.now();
        context.supply = (0, phase2_supply_1.buildVplanSupplyModel)({
            employees: snapshot.employees,
            days: snapshot.days,
            absences: snapshot.absences,
            suggestedHeadcount,
            previousMonthStateKey: snapshot.previousMonthStateKey,
            planningRules,
        });
        steps.push(step('2_supply', context.supply.employeeCount > 0, `${context.supply.employeeCount} guardias (${request.supplyScope ?? 'objective'}) · ${snapshot.existingAssignments.length} turnos en mes`, t2));
    }
    if (runPhases.has('3_feasibility') && context.demand && context.supply) {
        const t3 = Date.now();
        context.feasibility = (0, phase3_feasibility_1.buildVplanFeasibilityReport)({
            demand: context.demand,
            supply: context.supply,
            positions: snapshot.positions,
            days: snapshot.days,
            preferredCycle: effectiveCycle,
            budgetMode: request.budgetMode,
            planningRules,
        });
        steps.push(step('3_feasibility', context.feasibility.ok, context.feasibility.ok
            ? `Viable · ciclo ${context.feasibility.suggestedCycle} · ~${context.feasibility.offerHours}h oferta`
            : context.feasibility.reasons[0] ?? 'No viable', t3));
    }
    const needsGeneration = ['4_strategy', '5_generate', '6_exceptions', '7_verify', '8_fix', '9_optimize', '10_deliver']
        .some((p) => runPhases.has(p));
    if (needsGeneration && context.feasibility && !context.feasibility.ok) {
        context.steps = steps;
        return {
            version: VPLAN_VERSION,
            status: 'feasibility_failed',
            message: `VPLAN: viabilidad fallida — ${context.feasibility.reasons.join('; ')}`,
            context,
        };
    }
    if (runPhases.has('4_strategy')) {
        const t4 = Date.now();
        context.strategy = (0, phase4_strategy_1.buildVplanStrategy)({
            mode: request.mode,
            preferredCycle: effectiveCycle ?? context.feasibility?.suggestedCycle,
            hasExistingAssignments: snapshot.existingAssignments.length > 0,
            hasTrailing: hasTrailing(snapshot),
            hasPrevMonthShifts: snapshot.previousMonthAssignments.length > 0,
        });
        steps.push(step('4_strategy', true, `${context.strategy.engine} · ciclo ${context.strategy.cycle}${context.strategy.modes.useTrailing ? ` · racha ${(0, vplan_trailing_1.countTrailingEmployees)(snapshot.prevPlanningState)} guardias` : ''}`, t4));
    }
    if (runPhases.has('5_generate') && context.strategy) {
        const t5 = Date.now();
        try {
            context.draft = (0, phase5_generate_1.runVplanGeneration)({
                snapshot,
                planningState: snapshot.planningState,
                prevPlanningState: snapshot.prevPlanningState,
                strategy: context.strategy,
                planningRules,
                demand: context.demand,
            });
            const motorH = context.draft.stats?.motorBillableHours;
            const postH = Math.round(context.draft.stats?.totalBillableHours ?? 0);
            const hoursLabel = motorH != null && motorH !== postH
                ? `${postH}h (motor ${motorH}h)`
                : `${postH}h`;
            steps.push(step('5_generate', true, `${context.draft.assignments.length} celdas · ${hoursLabel} · ${context.draft.sourceEngine}${context.draft.stats?.trailingSlotCount ? ` · ${context.draft.stats.trailingSlotCount} racha(s)` : ''}${context.draft.stats?.needsReinforcementCount ? ` · ${context.draft.stats.needsReinforcementCount} NR` : ''}${context.draft.stats?.continuityFixes ? ` · ${context.draft.stats.continuityFixes} ajuste(s)` : ''}`, t5));
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Error en generación';
            steps.push(step('5_generate', false, msg, t5));
            context.steps = steps;
            return {
                version: VPLAN_VERSION,
                status: 'error',
                message: msg,
                context,
            };
        }
    }
    if (runPhases.has('6_exceptions') && context.draft && context.strategy) {
        const t6 = Date.now();
        const patched = (0, phase6_exceptions_1.applyVplanAbsenceExceptions)({
            draft: context.draft,
            absences: snapshot.absences,
            enabled: context.strategy.modes.patchAbsencesPostGenerate,
        });
        context.draft = patched.draft;
        steps.push(step('6_exceptions', true, `${patched.patchedDays} días marcados con ausencia`, t6));
    }
    const employeeNames = Object.fromEntries(snapshot.employees.map((e) => [e.id, e.displayName]));
    const cappedDefaultPosition = (0, vplan_sla_enforce_1.capDefaultPositionByEmp)(snapshot.positions, {
        ...snapshot.prevPlanningState.defaultPositionByEmp,
        ...snapshot.planningState.defaultPositionByEmp,
    }, context.strategy?.cycle);
    if (runPhases.has('7_verify') && context.draft && context.strategy) {
        const t7 = Date.now();
        context.verification = (0, phase7_verify_1.runVplanVerification)({
            snapshot,
            planningState: snapshot.planningState,
            prevPlanningState: snapshot.prevPlanningState,
            strategy: context.strategy,
            draft: context.draft,
            monthDemandHours: context.demand?.monthDemandHours,
            demand: context.demand,
            employeeNames,
            planningRules,
        });
        steps.push(step('7_verify', context.verification.ok, context.verification.ok
            ? `Cobertura OK · ${context.verification.billableHours}h · gap ${context.verification.hoursGap}h`
            : `${context.verification.issues.filter((i) => i.severity === 'blocking').length} bloqueante(s)`, t7));
    }
    if (runPhases.has('8_fix') && context.draft) {
        const t8 = Date.now();
        const monthFirstDate = snapshot.days[0]?.dateStr ?? '';
        const runYear = monthFirstDate ? Number(monthFirstDate.slice(0, 4)) : 0;
        const runMonth = monthFirstDate ? Number(monthFirstDate.slice(5, 7)) : 0;
        const prevCal = runYear && runMonth ? (0, vplan_calendar_1.previousMonth)(runYear, runMonth) : null;
        const prevCalLast = prevCal
            ? (0, vplan_calendar_1.buildMonthDays)(prevCal.year, prevCal.month).at(-1)?.dateStr
            : undefined;
        const prevMonthDateStrs = snapshot.previousMonthAssignments.length > 0
            ? snapshot.previousMonthAssignments.map((a) => a.dateStr).filter((d, i, arr) => arr.indexOf(d) === i).sort()
            : [];
        const prevMonthLastDate = prevCalLast
            ?? (prevMonthDateStrs.length > 0 ? prevMonthDateStrs[prevMonthDateStrs.length - 1] : '');
        const mergedDefaultShiftByEmp = {
            ...snapshot.prevPlanningState.defaultShiftByEmp,
            ...snapshot.planningState.defaultShiftByEmp,
        };
        let protectedCells;
        if (context.strategy?.modes.useTrailing && prevMonthLastDate && monthFirstDate) {
            if (context.draft.stats?.openingProtectedCells?.length) {
                protectedCells = new Set(context.draft.stats.openingProtectedCells);
            }
            else {
                protectedCells = (0, vplan_cycle_continuity_1.computeOpeningProtectedCells)({
                    previousMonthAssignments: snapshot.previousMonthAssignments,
                    prevMonthLastDate,
                    monthFirstDate,
                    prevPlanningState: snapshot.prevPlanningState,
                    positions: snapshot.positions,
                    defaultPositionByEmp: cappedDefaultPosition,
                    defaultShiftByEmp: mergedDefaultShiftByEmp,
                    cycle: context.strategy.cycle,
                    useTrailing: true,
                    draftAssignments: context.draft.assignments,
                });
            }
        }
        const brainReport = context.strategy && context.demand
            ? (0, vplan_brain_1.evaluateVplanBrainMandates)({
                mode: request.mode,
                strategy: context.strategy,
                draft: context.draft,
                demand: context.demand,
                snapshot,
                planningState: snapshot.planningState,
                prevPlanningState: snapshot.prevPlanningState,
                defaultPositionByEmp: cappedDefaultPosition,
                defaultShiftByEmp: mergedDefaultShiftByEmp,
                prevMonthLastDate,
                monthFirstDate,
                dateStrList: snapshot.days.map((d) => d.dateStr),
                supply: context.supply,
                feasibility: context.feasibility,
                planningRules,
            })
            : undefined;
        context.brainReport = brainReport;
        if (brainReport) {
            context.fixerDecision = {
                policy: brainReport.action,
                reason: brainReport.summary,
                preserveGeneration: brainReport.preserveGeneration,
            };
        }
        const fixed = (0, phase8_fix_1.runVplanDeterministicFixer)(context.draft, snapshot.days.map((d) => d.dateStr), {
            brainReport,
            action: brainReport?.action,
            previousMonthAssignments: snapshot.previousMonthAssignments,
            monthFirstDate,
            positions: (0, vplan_positions_1.positionsForCycle)(snapshot.positions, context.strategy?.cycle),
            dateMeta: snapshot.days,
            defaultPositionByEmp: cappedDefaultPosition,
            defaultShiftByEmp: mergedDefaultShiftByEmp,
            demand: context.demand,
            cycle: context.strategy?.cycle,
            strategy: context.strategy,
            snapshot,
            prevPlanningState: snapshot.prevPlanningState,
            prevMonthLastDate,
            employeeNames,
            planningRules,
            protectedCells,
        });
        context.draft = fixed.draft;
        context.fixerLog = fixed.log;
        const auditSummary = fixed.coverageAudit
            ? ` · audit ${fixed.coverageAudit.totalMissingSlots} gap(s) · ${fixed.coverageAudit.iterationsUsed ?? 0} iter`
            : '';
        const mandateSummary = brainReport
            ? `${brainReport.mandatesOk}/${brainReport.mandatesTotal} mandatos · ${brainReport.action}`
            : fixed.action;
        steps.push(step('8_fix', true, `${mandateSummary}: ${brainReport?.summary ?? fixed.action} · ${fixed.log.length} ajuste(s)${auditSummary}`, t8));
        if (context.strategy && runPhases.has('7_verify')) {
            context.verification = (0, phase7_verify_1.runVplanVerification)({
                snapshot,
                planningState: snapshot.planningState,
                prevPlanningState: snapshot.prevPlanningState,
                strategy: context.strategy,
                draft: context.draft,
                monthDemandHours: context.demand?.monthDemandHours,
                demand: context.demand,
                employeeNames,
                planningRules,
            });
            if (fixed.coverageAudit && context.verification) {
                context.verification.coverageAudit = fixed.coverageAudit;
            }
            const blockingAfterFix = context.verification.issues.filter((i) => i.severity === 'blocking').length;
            const verifyIdx = steps.findIndex((s) => s.phase === '7_verify');
            if (verifyIdx >= 0) {
                steps[verifyIdx] = step('7_verify', context.verification.ok, context.verification.ok
                    ? `Cobertura OK · ${context.verification.billableHours}h · gap ${context.verification.hoursGap}h`
                    : `${blockingAfterFix} bloqueante(s) post-solver`);
            }
        }
    }
    if (runPhases.has('9_optimize') && context.draft && context.verification && context.demand && context.supply) {
        const t9 = Date.now();
        const opt = await (0, phase9_optimize_1.runVplanOptimization)({
            enabled: request.runOptimization === true,
            snapshot,
            demand: context.demand,
            supply: context.supply,
            draft: context.draft,
            verification: context.verification,
        });
        context.draft = opt.draft;
        context.optimization = opt.result;
        steps.push(step('9_optimize', true, opt.result.applied
            ? `${opt.result.correctionCount} corrección(es) Gemini`
            : (opt.result.skippedReason ?? 'omitido'), t9));
        if (opt.result.applied && context.strategy) {
            context.verification = (0, phase7_verify_1.runVplanVerification)({
                snapshot,
                planningState: snapshot.planningState,
                prevPlanningState: snapshot.prevPlanningState,
                strategy: context.strategy,
                draft: context.draft,
                monthDemandHours: context.demand?.monthDemandHours,
                demand: context.demand,
                employeeNames,
                planningRules,
            });
        }
    }
    if (runPhases.has('10_deliver') && context.draft && context.verification) {
        const t10 = Date.now();
        context.deliverable = (0, phase10_deliver_1.buildVplanDeliverable)({
            draft: context.draft,
            verification: context.verification,
            existingAssignments: snapshot.existingAssignments,
            objectiveId: request.objectiveId,
            year: request.year,
            month: request.month,
            employeeNames: Object.fromEntries(snapshot.employees.map((e) => [e.id, e.displayName])),
        });
        steps.push(step('10_deliver', true, `Diff ${context.deliverable.diff.length} ops · ${context.deliverable.reportSummary.slice(0, 120)}…`, t10));
    }
    context.steps = steps;
    const feasibilityFailed = context.feasibility && !context.feasibility.ok;
    const verificationFailed = context.verification && !context.verification.ok;
    let status = 'ok';
    if (feasibilityFailed)
        status = 'feasibility_failed';
    else if (verificationFailed && runPhases.has('7_verify'))
        status = 'verification_failed';
    let message;
    if (status === 'feasibility_failed' && context.feasibility) {
        message = `VPLAN: viabilidad fallida — ${context.feasibility.reasons.join('; ')}`;
    }
    else if (status === 'verification_failed' && context.verification) {
        message = `VPLAN: pipeline completo con gaps — ${context.verification.issues.filter((i) => i.severity === 'blocking').length} bloqueante(s). Diff disponible en deliverable.`;
    }
    else if (context.deliverable) {
        message = `VPLAN pipeline completo: ${context.deliverable.assignmentCount} asignaciones, ${context.deliverable.billableHours}h facturables. Sin escritura Firestore (fase prueba).`;
    }
    else if (context.feasibility?.ok) {
        message = `VPLAN: fases hasta ${intent} completadas`;
    }
    else {
        message = `VPLAN: corrida ${intent}`;
    }
    return {
        version: VPLAN_VERSION,
        status,
        message,
        context,
    };
}
//# sourceMappingURL=vplan.orchestrator.js.map