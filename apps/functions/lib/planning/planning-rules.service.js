"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePlanningRules = resolvePlanningRules;
exports.loadPlanningRulesForEmpresa = loadPlanningRulesForEmpresa;
exports.planningRulesDocPath = planningRulesDocPath;
const admin = require("firebase-admin");
const planning_rules_defaults_1 = require("./planning-rules.defaults");
const db = () => admin.firestore();
function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}
function clampFloat(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
function mergeCycleRule(key, raw) {
    const base = planning_rules_defaults_1.DEFAULT_CYCLE_RULES[key];
    return {
        workDays: clampInt(raw?.workDays, 1, 12, base.workDays),
        restDays: clampInt(raw?.restDays, 1, 7, base.restDays),
        shiftHours: raw?.shiftHours === 12 ? 12 : 8,
        enabled: raw?.enabled !== false,
    };
}
function resolvePlanningRules(raw) {
    const cycles = {};
    for (const key of planning_rules_defaults_1.PLANNING_CYCLE_KEYS) {
        cycles[key] = mergeCycleRule(key, raw?.cycles?.[key]);
    }
    const defaultCycle = (0, planning_rules_defaults_1.normalizePlanningCycleKey)(raw?.defaultCycle ?? planning_rules_defaults_1.DEFAULT_PLANNING_RULES.defaultCycle);
    const status = raw?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return {
        status,
        updatedAt: raw?.updatedAt,
        updatedBy: raw?.updatedBy,
        cctMaxBillableHours: clampInt(raw?.cctMaxBillableHours, 80, 320, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.cctMaxBillableHours),
        targetAvgHoursPerEmployee: clampInt(raw?.targetAvgHoursPerEmployee, 120, 240, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.targetAvgHoursPerEmployee),
        minRestHoursBetweenBands: clampInt(raw?.minRestHoursBetweenBands, 4, 16, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.minRestHoursBetweenBands),
        maxConsecutiveWorkHours: clampInt(raw?.maxConsecutiveWorkHours, 24, 96, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.maxConsecutiveWorkHours),
        defaultCycle: cycles[defaultCycle]?.enabled ? defaultCycle : (planning_rules_defaults_1.PLANNING_CYCLE_KEYS.find((k) => cycles[k].enabled) ?? '6+2'),
        cycles,
        solverMaxIterations: clampInt(raw?.solverMaxIterations, 4, 96, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.solverMaxIterations),
        protectCoverageOnEnforce: raw?.protectCoverageOnEnforce !== false,
        slaHoursTolerance: clampInt(raw?.slaHoursTolerance, 0, 48, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.slaHoursTolerance),
        coverageRatioMin: clampFloat(raw?.coverageRatioMin, 0.9, 1, planning_rules_defaults_1.DEFAULT_PLANNING_RULES.coverageRatioMin),
    };
}
async function loadPlanningRulesForEmpresa(empresaId) {
    const id = String(empresaId || '').trim();
    if (!id)
        return resolvePlanningRules(null);
    try {
        const snap = await db().collection('planning_rules').doc(id).get();
        if (!snap.exists)
            return resolvePlanningRules(null);
        const data = snap.data();
        if (data.status === 'INACTIVE')
            return resolvePlanningRules(null);
        return resolvePlanningRules(data);
    }
    catch {
        return resolvePlanningRules(null);
    }
}
function planningRulesDocPath(empresaId) {
    return `planning_rules/${empresaId}`;
}
//# sourceMappingURL=planning-rules.service.js.map