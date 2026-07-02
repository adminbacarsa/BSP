"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanGeneration = runVplanGeneration;
const autoScheduleEngine_1 = require("../../scheduling/autoScheduleEngine");
const vplan_engine_bridge_1 = require("../vplan.engine-bridge");
function runVplanGeneration(opts) {
    const ctx = (0, vplan_engine_bridge_1.buildEngineContext)({
        snapshot: opts.snapshot,
        planningState: opts.planningState,
        prevPlanningState: opts.prevPlanningState,
        strategy: opts.strategy,
    });
    const result = (0, autoScheduleEngine_1.generateSchedule)(ctx);
    let assignments = (0, vplan_engine_bridge_1.engineToVplanAssignments)(result.assignments);
    if (opts.strategy.modes.preserveExisting && opts.snapshot.existingAssignments.length > 0) {
        const existingMap = new Map();
        for (const a of opts.snapshot.existingAssignments) {
            existingMap.set(`${a.employeeId}_${a.dateStr}`, a);
        }
        const generatedMap = new Map();
        for (const a of assignments) {
            generatedMap.set(`${a.employeeId}_${a.dateStr}`, a);
        }
        const mergedKeys = new Set([...existingMap.keys(), ...generatedMap.keys()]);
        assignments = [];
        for (const key of mergedKeys) {
            assignments.push(existingMap.get(key) ?? generatedMap.get(key));
        }
    }
    return {
        assignments,
        sourceEngine: `vplan:${opts.strategy.engine}:${opts.strategy.cycle}`,
        stats: {
            totalBillableHours: result.stats.totalBillableHours,
            targetHours: result.stats.targetHours,
            slaHoursClosed: result.stats.slaHoursClosed,
            employeeCount: opts.snapshot.employees.length,
        },
    };
}
//# sourceMappingURL=phase5-generate.js.map