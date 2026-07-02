/**
 * Callable Firebase VPLAN — solo emulador / prueba hasta sign-off (docs/VPLAN.md §10).
 */

import * as functions from 'firebase-functions/v1';
import { runVplanOrchestrator } from './vplan.orchestrator';
import type { VplanRunRequest } from './vplan.types';

async function vplanRunHandler(
  data: VplanRunRequest,
  context: functions.https.CallableContext,
): Promise<ReturnType<typeof runVplanOrchestrator>> {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'VPLAN está en etapa de prueba: solo disponible en emulador hasta sign-off (docs/VPLAN.md).',
    );
  }

  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sesión requerida');
  }

  const request: VplanRunRequest = {
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

  return runVplanOrchestrator(request);
}

/** Runtime conservador; subir en olas posteriores si hace falta. */
const vplanRuntime: functions.RuntimeOptions = {
  timeoutSeconds: 120,
  memory: '512MB',
};

export const vplanRun = functions
  .runWith(vplanRuntime)
  .https.onCall(vplanRunHandler);
