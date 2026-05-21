"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANNING_AGENT_PIPELINE = void 0;
exports.describePlanningAgentPipeline = describePlanningAgentPipeline;
exports.PLANNING_AGENT_PIPELINE = [
    'feasibility',
    'generate',
    'verify',
    'optimize',
];
function describePlanningAgentPipeline() {
    return [
        '1. feasibility — autoScheduleEngineV2.checkFeasibility',
        '2. generate — autoScheduleEngineV2.generateScheduleV2',
        '3. verify — coverageVerification.verifyCoverage',
        '4. optimize — optimizePlanningGemini (ajuste fino, no cronograma nuevo)',
    ].join('\n');
}
//# sourceMappingURL=planningAgentTypes.js.map