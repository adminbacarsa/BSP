"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vplanRun = void 0;
const functions = require("firebase-functions/v1");
const vplan_orchestrator_1 = require("./vplan.orchestrator");
async function vplanRunHandler(data, context) {
    if (process.env.FUNCTIONS_EMULATOR !== 'true') {
        throw new functions.https.HttpsError('failed-precondition', 'VPLAN está en etapa de prueba: solo disponible en emulador hasta sign-off (docs/VPLAN.md).');
    }
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Sesión requerida');
    }
    const request = {
        empresaId: String(data?.empresaId ?? ''),
        objectiveId: String(data?.objectiveId ?? ''),
        year: Number(data?.year),
        month: Number(data?.month),
        mode: data?.mode ?? 'GREENFIELD',
        intent: data?.intent,
        budgetMode: data?.budgetMode,
        preferredCycle: data?.preferredCycle,
        runOptimization: data?.runOptimization === true,
        employeeIds: Array.isArray(data?.employeeIds) ? data.employeeIds : undefined,
    };
    if (!Number.isFinite(request.year) || !Number.isFinite(request.month)) {
        throw new functions.https.HttpsError('invalid-argument', 'year y month inválidos');
    }
    return (0, vplan_orchestrator_1.runVplanOrchestrator)(request);
}
const vplanRuntime = {
    timeoutSeconds: 120,
    memory: '512MB',
};
exports.vplanRun = functions
    .runWith(vplanRuntime)
    .https.onCall(vplanRunHandler);
//# sourceMappingURL=vplan.handler.js.map