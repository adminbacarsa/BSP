"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanOrchestrator = runVplanOrchestrator;
const vplan_firestore_1 = require("./vplan.firestore");
const phase0_intake_1 = require("./phases/phase0-intake");
const phase1_demand_1 = require("./phases/phase1-demand");
const phase2_supply_1 = require("./phases/phase2-supply");
const phase3_feasibility_1 = require("./phases/phase3-feasibility");
const VPLAN_VERSION = 'VPLAN_0.1';
function step(phase, ok, summary, startedAt) {
    return {
        phase,
        ok,
        summary,
        durationMs: startedAt ? Date.now() - startedAt : undefined,
    };
}
function shouldRunPhase(intent, phaseId) {
    if (intent === 'full')
        return true;
    const map = {
        intake: ['0_intake'],
        demand: ['0_intake', '1_demand'],
        supply: ['0_intake', '1_demand', '2_supply'],
        feasibility: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        strategy: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        generate: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        exceptions: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        verify: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        fix: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        optimize: ['0_intake', '1_demand', '2_supply', '3_feasibility'],
        full: [],
    };
    return (map[intent] ?? []).includes(phaseId);
}
function stubPhases(intent, steps) {
    if (intent !== 'full')
        return;
    const pending = [
        '4_strategy', '5_generate', '6_exceptions', '7_verify', '8_fix', '9_optimize', '10_deliver',
    ];
    for (const phase of pending) {
        steps.push(step(phase, true, 'Pendiente — Ola 2+ (docs/VPLAN.md)'));
    }
}
async function runVplanOrchestrator(request) {
    const steps = [];
    const intent = request.intent ?? 'full';
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
    if (shouldRunPhase(intent, '0_intake')) {
        const t0 = Date.now();
        const intake = (0, phase0_intake_1.buildVplanIntake)(request, snapshot);
        context.intake = intake;
        steps.push(step('0_intake', true, `${intake.objectiveName ?? intake.objectiveId} · modo ${intake.mode} · ${intake.positionCount} puestos · ${intake.employeeCount} guardias · SLA ${snapshot.slaId}`, t0));
    }
    if (shouldRunPhase(intent, '1_demand')) {
        const t1 = Date.now();
        context.demand = (0, phase1_demand_1.buildVplanDemandModel)({
            positions: snapshot.positions,
            days: snapshot.days,
            slaVendidas: snapshot.slaVendidas,
        });
        const peak = context.demand.dayDemands.reduce((b, d) => (d.totalPaxUnits > (b?.totalPaxUnits ?? 0) ? d : b), context.demand.dayDemands[0]);
        steps.push(step('1_demand', true, `${Math.round(context.demand.monthDemandHours)}h estructura · ${context.demand.slaVendidas}h vendidas · pico ${peak?.totalPaxUnits ?? 0} pax`, t1));
    }
    let suggestedHeadcount;
    if (shouldRunPhase(intent, '3_feasibility') && context.demand) {
        const pre = (0, phase3_feasibility_1.buildVplanFeasibilityReport)({
            demand: context.demand,
            supply: (0, phase2_supply_1.buildVplanSupplyModel)({
                employees: snapshot.employees,
                days: snapshot.days,
                absences: snapshot.absences,
                previousMonthStateKey: snapshot.previousMonthStateKey,
            }),
            positions: snapshot.positions,
            days: snapshot.days,
            preferredCycle: request.preferredCycle,
            budgetMode: request.budgetMode,
        });
        suggestedHeadcount = pre.suggestedHeadcount;
    }
    if (shouldRunPhase(intent, '2_supply')) {
        const t2 = Date.now();
        context.supply = (0, phase2_supply_1.buildVplanSupplyModel)({
            employees: snapshot.employees,
            days: snapshot.days,
            absences: snapshot.absences,
            suggestedHeadcount,
            previousMonthStateKey: snapshot.previousMonthStateKey,
        });
        const absDays = context.supply.employees.reduce((s, e) => s + e.blockedDates.length, 0);
        steps.push(step('2_supply', context.supply.employeeCount > 0, `${context.supply.employeeCount} guardias · ${absDays} días bloqueados por ausencias`, t2));
    }
    if (shouldRunPhase(intent, '3_feasibility') && context.demand && context.supply) {
        const t3 = Date.now();
        context.feasibility = (0, phase3_feasibility_1.buildVplanFeasibilityReport)({
            demand: context.demand,
            supply: context.supply,
            positions: snapshot.positions,
            days: snapshot.days,
            preferredCycle: request.preferredCycle,
            budgetMode: request.budgetMode,
        });
        steps.push(step('3_feasibility', context.feasibility.ok, context.feasibility.ok
            ? `Viable · ciclo ${context.feasibility.suggestedCycle} · oferta ~${context.feasibility.offerHours}h vs ${context.feasibility.effectiveTargetHours}h`
            : context.feasibility.reasons[0] ?? 'No viable', t3));
    }
    stubPhases(intent, steps);
    context.steps = steps;
    const feasibilityFailed = context.feasibility && !context.feasibility.ok;
    const status = feasibilityFailed
        ? 'feasibility_failed'
        : context.feasibility
            ? 'ok'
            : 'ok';
    let message;
    if (feasibilityFailed && context.feasibility) {
        message = `VPLAN: viabilidad fallida — ${context.feasibility.reasons.join('; ')}`;
    }
    else if (context.feasibility?.ok) {
        message = `VPLAN Ola 1: demanda, oferta y viabilidad OK. Generación pendiente (Ola 2).`;
    }
    else if (intent === 'intake' || intent === 'demand' || intent === 'supply') {
        message = `VPLAN: fase ${intent} completada`;
    }
    else {
        message = 'VPLAN: orquestador activo — fases 4–10 en Ola 2+';
    }
    return {
        version: VPLAN_VERSION,
        status,
        message,
        context,
    };
}
//# sourceMappingURL=vplan.orchestrator.js.map