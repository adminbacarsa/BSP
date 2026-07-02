"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVplanFeasibilityReport = buildVplanFeasibilityReport;
const vplan_positions_1 = require("../vplan.positions");
const phase2_supply_1 = require("./phase2-supply");
const TARGET_AVG_HOURS = 192;
const HARD_MAX_CCT_HOURS = 200;
const CYCLE_MAP = {
    '6+2': [6, 2],
    '4+2': [4, 2],
    '5+1': [5, 1],
    '6+1': [6, 1],
};
function resolveCycle(preferred) {
    const key = (preferred && CYCLE_MAP[preferred]
        ? preferred
        : '6+2');
    const [work, rest] = CYCLE_MAP[key];
    const factor = (work + rest) / work;
    const avgShiftHours = key === '4+2' ? 12 : 8;
    return { key, factor, avgShiftHours };
}
function computePeakConcurrent(positions, days) {
    let peak = 0;
    for (const day of days) {
        let concurrent = 0;
        for (const pos of positions) {
            if (!(0, vplan_positions_1.isPositionActiveOnDay)(pos, day.dayLetter))
                continue;
            if ((0, vplan_positions_1.is24hsPosition)(pos))
                concurrent += pos.qty;
            else
                concurrent += pos.qty * Math.max(1, pos.shifts.length);
        }
        if (concurrent > peak)
            peak = concurrent;
    }
    return peak;
}
function computeSuggestedHeadcount(positions, days, cycleKey) {
    let total = 0;
    const perQty24 = cycleKey === '4+2' ? 3 : 4;
    for (const pos of positions) {
        const activeDays = days.filter((d) => (0, vplan_positions_1.isPositionActiveOnDay)(pos, d.dayLetter)).length;
        const isLimited = activeDays > 0 && activeDays < days.length;
        if ((0, vplan_positions_1.is24hsPosition)(pos)) {
            total += Math.ceil(pos.qty * (isLimited ? 1 : perQty24));
        }
        else {
            total += Math.ceil(pos.qty);
        }
    }
    return total;
}
function buildVplanFeasibilityReport(opts) {
    const { key: cycleKey, factor: cycleFactor, avgShiftHours } = resolveCycle(opts.preferredCycle);
    const workRatio = CYCLE_MAP[cycleKey][0] / (CYCLE_MAP[cycleKey][0] + CYCLE_MAP[cycleKey][1]);
    const peakConcurrent = computePeakConcurrent(opts.positions, opts.days);
    const suggestedHeadcount = computeSuggestedHeadcount(opts.positions, opts.days, cycleKey);
    const peopleAvailable = opts.supply.employees.filter((e) => e.availableDays > 0).length;
    const offerHours = (0, phase2_supply_1.estimateOfferHours)(opts.supply, avgShiftHours, workRatio);
    const contractedHours = Math.max(0, opts.demand.slaVendidas);
    const structuralHours = opts.demand.monthDemandHours;
    const effectiveTarget = contractedHours > 0 ? contractedHours : structuralHours;
    const peopleNeededForTarget = Math.ceil(effectiveTarget / TARGET_AVG_HOURS);
    const reasons = [];
    const warnings = [...opts.demand.warnings];
    if (opts.supply.employeeCount === 0) {
        reasons.push('No hay empleados activos asignados al objetivo');
    }
    if (peopleAvailable < peopleNeededForTarget) {
        reasons.push(`Dotación insuficiente por horas: hacen falta ~${peopleNeededForTarget} personas con ${TARGET_AVG_HOURS}h c/u para ${Math.round(effectiveTarget)}h y hay ${peopleAvailable} con días disponibles`);
    }
    if (opts.supply.employeeCount < suggestedHeadcount) {
        reasons.push(`Plantilla estructural: se sugieren ${suggestedHeadcount} guardias (ciclo ${cycleKey}) y hay ${opts.supply.employeeCount}`);
    }
    if (effectiveTarget > 0 && offerHours < effectiveTarget * 0.92) {
        reasons.push(`Oferta horaria estimada ${Math.round(offerHours)}h < objetivo ${Math.round(effectiveTarget)}h (faltan ~${Math.round(effectiveTarget - offerHours)}h)`);
    }
    const overCct = opts.supply.employees.filter((e) => (e.cctHoursRemaining ?? HARD_MAX_CCT_HOURS) < avgShiftHours * 3);
    if (overCct.length > 0) {
        warnings.push(`${overCct.length} empleado(s) con poco margen CCT (<${avgShiftHours * 3}h restantes en ciclo)`);
    }
    if (contractedHours > 0 && structuralHours > 0) {
        const diffPct = Math.abs(structuralHours - contractedHours) / contractedHours;
        if (diffPct > 0.1) {
            warnings.push(`Estructura (${Math.round(structuralHours)}h) vs vendidas (${Math.round(contractedHours)}h): revisar SLA o qty/bandas`);
        }
    }
    const peakDay = opts.demand.dayDemands.reduce((best, d) => (d.totalPaxUnits > (best?.totalPaxUnits ?? 0) ? d : best), opts.demand.dayDemands[0]);
    if (peakDay) {
        const slotsNeeded = peakDay.positions.reduce((s, p) => s + Object.values(p.bandSlots).reduce((a, b) => a + b, 0), 0);
        const availPersonDays = opts.supply.employees.reduce((s, e) => s + e.availableDays, 0);
        if (slotsNeeded > 0 && availPersonDays < slotsNeeded) {
            warnings.push(`Día pico: ${slotsNeeded} slots/día vs ${availPersonDays} días-persona disponibles (con ausencias)`);
        }
    }
    return {
        ok: reasons.length === 0,
        reasons,
        warnings,
        suggestedCycle: cycleKey,
        suggestedHeadcount,
        peakConcurrent,
        peopleAvailable,
        offerHours: Math.round(offerHours),
        effectiveTargetHours: Math.round(effectiveTarget),
    };
}
//# sourceMappingURL=phase3-feasibility.js.map