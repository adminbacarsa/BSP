"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanOrchestrator = runVplanOrchestrator;
const VPLAN_VERSION = 'VPLAN_0.1';
function step(phase, ok, summary) {
    return { phase, ok, summary };
}
async function runVplanOrchestrator(request) {
    const steps = [];
    const intent = request.intent ?? 'full';
    if (!request.empresaId || !request.objectiveId) {
        return {
            version: VPLAN_VERSION,
            status: 'error',
            message: 'empresaId y objectiveId son obligatorios',
            context: { run: request, steps },
        };
    }
    steps.push(step('0_intake', true, `Modo ${request.mode} · intent ${intent} · ${request.year}-${String(request.month).padStart(2, '0')}`));
    const context = { run: request, steps };
    const pendingPhases = [
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
    for (const phase of pendingPhases) {
        if (intent !== 'full' && !intent.startsWith(phase.split('_')[1]?.slice(0, 4) ?? 'xxxx')) {
            continue;
        }
        steps.push(step(phase, true, 'Pendiente de implementación — ver docs/VPLAN.md y roadmap Ola 1+'));
    }
    return {
        version: VPLAN_VERSION,
        status: 'stub',
        message: 'VPLAN Ola 0: orquestador activo en emulador. Pipeline documentado; fases 1–10 en desarrollo paralelo.',
        context,
    };
}
//# sourceMappingURL=vplan.orchestrator.js.map