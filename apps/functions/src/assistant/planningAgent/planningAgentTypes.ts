/**
 * Contrato del agente unificado de planificación automática COSP.
 * Orquestación en cliente (V2 + verificación); ajuste fino en optimizePlanningGemini.
 */

import type { GeminiCorreccion, GeminiRespuesta, PlannerContext } from '../planningGeminiServer';

export type { GeminiCorreccion, GeminiRespuesta, PlannerContext };

/** Intenciones soportadas / planificadas para el agente. */
export type PlanningAgentIntent =
  | 'feasibility'
  | 'generate'
  | 'verify'
  | 'optimize'
  | 'explain';

export interface PlanningAgentStepResult {
  step: PlanningAgentIntent;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

/** Resultado objetivo de una corrida completa (ensamblado en UI). */
export interface PlanningAgentRunResult {
  intent: PlanningAgentIntent;
  steps: PlanningAgentStepResult[];
  gemini?: GeminiRespuesta;
  /** Correcciones listas para mapear a pendingChanges en planificador. */
  corrections?: GeminiCorreccion[];
}

/** Pasos en orden de producción recomendado. */
export const PLANNING_AGENT_PIPELINE: PlanningAgentIntent[] = [
  'feasibility',
  'generate',
  'verify',
  'optimize',
];

export function describePlanningAgentPipeline(): string {
  return [
    '1. feasibility — autoScheduleEngineV2.checkFeasibility',
    '2. generate — autoScheduleEngineV2.generateScheduleV2',
    '3. verify — coverageVerification.verifyCoverage',
    '4. optimize — optimizePlanningGemini (ajuste fino, no cronograma nuevo)',
  ].join('\n');
}
