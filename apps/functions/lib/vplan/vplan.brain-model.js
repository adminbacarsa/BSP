"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COVERAGE_LADDER = exports.HOURS_PER_CYCLE_BLOCK = exports.CONTINGENCY_CYCLE = exports.OBJECTIVE_CYCLE_DEFAULT = void 0;
exports.describePlanningLayers = describePlanningLayers;
exports.assessCapacityVsSla = assessCapacityVsSla;
exports.computeHourHeadroom = computeHourHeadroom;
exports.candidateLegalFor6x2 = candidateLegalFor6x2;
exports.recommendCoverageLadderStep = recommendCoverageLadderStep;
exports.ladderMessage = ladderMessage;
exports.maxWorkDaysForPlanningCycle = maxWorkDaysForPlanningCycle;
exports.buildFeasibilityHourOffer = buildFeasibilityHourOffer;
const planning_rules_defaults_1 = require("../planning/planning-rules.defaults");
const vplan_cct_enforce_1 = require("./vplan.cct-enforce");
exports.OBJECTIVE_CYCLE_DEFAULT = '6+2';
exports.CONTINGENCY_CYCLE = '4+2';
exports.HOURS_PER_CYCLE_BLOCK = 48;
exports.COVERAGE_LADDER = [
    {
        step: 1,
        key: 'SUBGRUPO_6X2_LEGAL',
        label: 'Mismo subgrupo/puesto en F legal (6+2)',
        cost: 'normal',
        breaks6x2: false,
    },
    {
        step: 2,
        key: 'REFUERZO_4X2_OBJETIVO',
        label: 'Guardia del objetivo en ciclo 4+2 (12h) — requiere headroom de horas',
        cost: 'horas_extra_mismo_objetivo',
        breaks6x2: false,
        requiresHourHeadroom: true,
    },
    {
        step: 3,
        key: 'SIN_TURNO_OBJETIVO',
        label: 'Personal sin turno asignado que conozca el objetivo',
        cost: 'asignacion_nueva',
        breaks6x2: false,
    },
    {
        step: 4,
        key: 'RET_OBJETIVO',
        label: 'Personal en RET (stand-by del objetivo)',
        cost: 'retencion',
        breaks6x2: false,
    },
    {
        step: 5,
        key: 'FT_FRANCO_TRABAJADO',
        label: 'Guardia del objetivo en Franco — FT (doble costo, última opción)',
        cost: 'doble_pago',
        breaks6x2: true,
        requiresValidation: true,
    },
];
function describePlanningLayers(opts) {
    return [
        {
            key: 'CICLO_OBJETIVO',
            label: 'Ciclo objetivo',
            value: opts.objectiveCycle,
            notes: 'Plantilla titular M/T/N 8h · máx 6 trab → 2F',
        },
        {
            key: 'CONTINGENCIA_4X2',
            label: 'Contingencia 4+2',
            value: opts.hourHeadroom.canUseContingency4x2 ? 'disponible' : 'sin headroom',
            notes: opts.hourHeadroom.canUseContingency4x2
                ? `Headroom ~${Math.round(opts.hourHeadroom.headroomHours)}h para refuerzo D12/N12`
                : 'No asignar 4+2 sin capacidad de horas en el objetivo',
        },
        {
            key: 'OFFSET_RACHA',
            label: 'Offset racha (trailing)',
            value: opts.useTrailing ? `${opts.trailingEmployeeCount} guardia(s)` : 'n/a',
            notes: opts.useTrailing
                ? 'Continuidad mes anterior — no reiniciar plantilla'
                : 'GREENFIELD / sin junio previo',
        },
    ];
}
function assessCapacityVsSla(opts) {
    const tolerance = opts.tolerance ?? 8;
    const n = Math.max(0, opts.employeeCount);
    const sla = Math.max(0, opts.slaVendidas);
    const offer = Math.max(0, opts.offerHours);
    const target = opts.targetAvgHoursPerEmployee ?? 192;
    const avgRequired = n > 0 && sla > 0 ? Math.round((sla / n) * 10) / 10 : 0;
    const avgOffer = n > 0 && offer > 0 ? Math.round((offer / n) * 10) / 10 : 0;
    const capacityAdequate = n > 0 && sla > 0 && offer >= sla - tolerance && avgRequired <= target;
    let summary;
    if (n <= 0 || sla <= 0) {
        summary = 'Sin datos de plantilla o SLA';
    }
    else if (capacityAdequate) {
        summary = `${n} guardias · ${avgRequired}h/guardia requerido vs ~${avgOffer}h oferta (6+2) — capacidad OK`;
    }
    else if (offer < sla - tolerance) {
        summary = `${n} guardias · faltan ~${Math.round(sla - offer)}h oferta total`;
    }
    else {
        summary = `${n} guardias · ${avgRequired}h/guardia supera tope ${target}h`;
    }
    return { avgHoursRequiredPerGuard: avgRequired, avgHoursOfferPerGuard: avgOffer, capacityAdequate, summary };
}
function computeHourHeadroom(opts) {
    const tolerance = opts.tolerance ?? 8;
    const sla = opts.slaVendidas;
    const billable = opts.billableHours;
    const offer = opts.offerHours ?? sla;
    const gapToSla = sla > 0 ? sla - billable : 0;
    const headroomHours = Math.max(0, offer - billable);
    const canUseContingency4x2 = headroomHours >= exports.HOURS_PER_CYCLE_BLOCK - tolerance
        || gapToSla >= exports.HOURS_PER_CYCLE_BLOCK - tolerance;
    const capacity = opts.employeeCount && opts.employeeCount > 0
        ? assessCapacityVsSla({
            employeeCount: opts.employeeCount,
            slaVendidas: sla,
            offerHours: offer,
            targetAvgHoursPerEmployee: opts.targetAvgHoursPerEmployee,
            tolerance,
        })
        : null;
    const assignmentGapNotHeadcount = !!capacity?.capacityAdequate && gapToSla > tolerance;
    let summary;
    if (sla <= 0) {
        summary = `${billable}h facturables`;
    }
    else if (assignmentGapNotHeadcount) {
        summary = `${capacity.summary} · asignación ${billable}h (faltan ${gapToSla}h) — redistribuir, no sumar gente`;
    }
    else if (gapToSla > tolerance) {
        summary = canUseContingency4x2
            ? `Faltan ${gapToSla}h SLA · headroom ${Math.round(headroomHours)}h → puede 4+2`
            : `Faltan ${gapToSla}h SLA · sin headroom para 4+2`;
    }
    else {
        summary = capacity?.capacityAdequate
            ? `${billable}h / ${sla}h SLA OK · ${capacity.summary}`
            : `${billable}h / ${sla}h SLA OK`;
    }
    return {
        slaVendidas: sla,
        billableHours: billable,
        offerHours: offer,
        gapToSla,
        headroomHours,
        canUseContingency4x2,
        summary,
        employeeCount: opts.employeeCount,
        avgHoursRequiredPerGuard: capacity?.avgHoursRequiredPerGuard,
        avgHoursOfferPerGuard: capacity?.avgHoursOfferPerGuard,
        assignmentGapNotHeadcount,
    };
}
function candidateLegalFor6x2(opts) {
    const r = (0, vplan_cct_enforce_1.wouldExceedCctWorkStreak)({
        assignments: opts.assignments,
        dateStrs: opts.dateStrList,
        empId: opts.empId,
        dateStr: opts.dateStr,
        shiftCode: opts.shiftCode,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
        rules: opts.rules,
    });
    return r.ok;
}
function recommendCoverageLadderStep(opts) {
    if (opts.onlyFtLeft)
        return 'FT_FRANCO_TRABAJADO';
    if (opts.hourHeadroom.canUseContingency4x2)
        return 'REFUERZO_4X2_OBJETIVO';
    if (opts.hasUnassignedPool)
        return 'SIN_TURNO_OBJETIVO';
    if (opts.hasRetAvailable)
        return 'RET_OBJETIVO';
    return 'FT_FRANCO_TRABAJADO';
}
function ladderMessage(step, dateStr, positionName, shiftCode) {
    const row = exports.COVERAGE_LADDER.find((r) => r.key === step);
    return `${row?.label ?? step}: ${shiftCode} en ${positionName} (${dateStr})`;
}
function maxWorkDaysForPlanningCycle(cycle, rules) {
    return (0, planning_rules_defaults_1.workDaysForCycle)(cycle, rules ?? planning_rules_defaults_1.DEFAULT_PLANNING_RULES);
}
function buildFeasibilityHourOffer(demand, supply, feasibility) {
    if (feasibility?.offerHours && feasibility.offerHours > 0) {
        return feasibility.offerHours;
    }
    if (supply?.employees?.length) {
        return supply.employees.reduce((s, e) => s + (e.cctHoursRemaining ?? 0), 0);
    }
    return demand?.slaVendidas ?? 0;
}
//# sourceMappingURL=vplan.brain-model.js.map