"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PLANNING_RULES = exports.DEFAULT_CYCLE_RULES = exports.PLANNING_CYCLE_KEYS = void 0;
exports.normalizePlanningCycleKey = normalizePlanningCycleKey;
exports.enabledCyclesFromRules = enabledCyclesFromRules;
exports.workDaysForCycle = workDaysForCycle;
exports.restDaysForCycle = restDaysForCycle;
exports.shiftHoursForCycle = shiftHoursForCycle;
exports.isCycleEnabled = isCycleEnabled;
exports.PLANNING_CYCLE_KEYS = ['6+2', '4+2', '5+1', '6+1'];
exports.DEFAULT_CYCLE_RULES = {
    '6+2': { workDays: 6, restDays: 2, shiftHours: 8, enabled: true },
    '4+2': { workDays: 4, restDays: 2, shiftHours: 12, enabled: true },
    '5+1': { workDays: 5, restDays: 1, shiftHours: 8, enabled: true },
    '6+1': { workDays: 6, restDays: 1, shiftHours: 8, enabled: true },
};
exports.DEFAULT_PLANNING_RULES = {
    status: 'ACTIVE',
    cctMaxBillableHours: 200,
    targetAvgHoursPerEmployee: 192,
    minRestHoursBetweenBands: 8,
    maxConsecutiveWorkHours: 56,
    defaultCycle: '6+2',
    cycles: { ...exports.DEFAULT_CYCLE_RULES },
    solverMaxIterations: 48,
    protectCoverageOnEnforce: true,
    slaHoursTolerance: 8,
    coverageRatioMin: 0.98,
};
function normalizePlanningCycleKey(cycle) {
    if (cycle === '4+2' || cycle === '5+1' || cycle === '6+1')
        return cycle;
    return '6+2';
}
function enabledCyclesFromRules(rules) {
    return exports.PLANNING_CYCLE_KEYS.filter((k) => rules.cycles[k]?.enabled !== false);
}
function workDaysForCycle(cycle, rules) {
    const key = normalizePlanningCycleKey(cycle);
    return rules.cycles[key]?.workDays ?? exports.DEFAULT_CYCLE_RULES[key].workDays;
}
function restDaysForCycle(cycle, rules) {
    const key = normalizePlanningCycleKey(cycle);
    return rules.cycles[key]?.restDays ?? exports.DEFAULT_CYCLE_RULES[key].restDays;
}
function shiftHoursForCycle(cycle, rules) {
    const key = normalizePlanningCycleKey(cycle);
    return rules.cycles[key]?.shiftHours ?? exports.DEFAULT_CYCLE_RULES[key].shiftHours;
}
function isCycleEnabled(cycle, rules) {
    const key = normalizePlanningCycleKey(cycle);
    return rules.cycles[key]?.enabled !== false;
}
//# sourceMappingURL=planning-rules.defaults.js.map