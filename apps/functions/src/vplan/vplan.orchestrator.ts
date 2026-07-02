/**
 * VPLAN — orquestador (fase prueba).
 * Pipeline completo documentado en docs/VPLAN.md.
 * No importa motores legacy (V2/V4); etapas se implementan incrementalmente aquí.
 */

import type {
  VplanBrainContext,
  VplanRunRequest,
  VplanRunResponse,
  VplanStepResult,
} from './vplan.types';

const VPLAN_VERSION = 'VPLAN_0.1';

function step(phase: string, ok: boolean, summary: string): VplanStepResult {
  return { phase, ok, summary };
}

/**
 * Ejecuta la corrida VPLAN. En Ola 0 solo valida intake y devuelve diagnóstico stub.
 * Las fases 1–10 se irán enchufando sin tocar planificador legacy.
 */
export async function runVplanOrchestrator(request: VplanRunRequest): Promise<VplanRunResponse> {
  const steps: VplanStepResult[] = [];
  const intent = request.intent ?? 'full';

  if (!request.empresaId || !request.objectiveId) {
    return {
      version: VPLAN_VERSION,
      status: 'error',
      message: 'empresaId y objectiveId son obligatorios',
      context: { run: request, steps },
    };
  }

  steps.push(step(
    '0_intake',
    true,
    `Modo ${request.mode} · intent ${intent} · ${request.year}-${String(request.month).padStart(2, '0')}`,
  ));

  const context: VplanBrainContext = { run: request, steps };

  // Ola 0: las fases siguientes devuelven placeholder hasta implementación.
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
    steps.push(step(
      phase,
      true,
      'Pendiente de implementación — ver docs/VPLAN.md y roadmap Ola 1+',
    ));
  }

  return {
    version: VPLAN_VERSION,
    status: 'stub',
    message:
      'VPLAN Ola 0: orquestador activo en emulador. Pipeline documentado; fases 1–10 en desarrollo paralelo.',
    context,
  };
}
