import type { GeminiCorreccion, GeminiRespuesta, PlannerContext } from '../planningGeminiServer';
export type { GeminiCorreccion, GeminiRespuesta, PlannerContext };
export type PlanningAgentIntent = 'feasibility' | 'generate' | 'verify' | 'optimize' | 'explain';
export interface PlanningAgentStepResult {
    step: PlanningAgentIntent;
    ok: boolean;
    summary: string;
    data?: Record<string, unknown>;
}
export interface PlanningAgentRunResult {
    intent: PlanningAgentIntent;
    steps: PlanningAgentStepResult[];
    gemini?: GeminiRespuesta;
    corrections?: GeminiCorreccion[];
}
export declare const PLANNING_AGENT_PIPELINE: PlanningAgentIntent[];
export declare function describePlanningAgentPipeline(): string;
