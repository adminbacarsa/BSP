"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVplanSupplyModel = buildVplanSupplyModel;
exports.estimateOfferHours = estimateOfferHours;
const planning_rules_service_1 = require("../../planning/planning-rules.service");
function buildVplanSupplyModel(opts) {
    const rules = (0, planning_rules_service_1.resolvePlanningRules)(opts.planningRules ?? null);
    const cctMax = rules.cctMaxBillableHours;
    const monthDayCount = opts.days.length;
    const employees = opts.employees.map((emp) => {
        const blocked = opts.absences[emp.id] ?? new Set();
        const blockedDates = [...blocked].sort();
        const availableDays = monthDayCount - blockedDates.length;
        const prior = Math.max(0, emp.priorCctHours);
        const cctHoursRemaining = Math.max(0, cctMax - prior);
        return {
            employeeId: emp.id,
            displayName: emp.displayName,
            blockedDates,
            availableDays,
            cctHoursUsed: prior,
            cctHoursRemaining,
        };
    });
    return {
        employeeCount: employees.length,
        employees,
        suggestedHeadcount: opts.suggestedHeadcount,
        previousMonthSnapshotId: opts.previousMonthStateKey,
    };
}
function estimateOfferHours(supply, avgShiftHours = 8, workRatio = 6 / 7, cctMaxFallback = 200) {
    return supply.employees.reduce((sum, emp) => {
        const workable = Math.max(0, emp.availableDays) * workRatio;
        const capByDays = Math.ceil(workable) * avgShiftHours;
        const capByCct = emp.cctHoursRemaining ?? cctMaxFallback;
        return sum + Math.min(capByDays, capByCct);
    }, 0);
}
//# sourceMappingURL=phase2-supply.js.map