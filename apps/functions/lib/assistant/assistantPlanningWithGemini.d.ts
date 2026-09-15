import type { GeminiCorreccion, GeminiRespuesta, PlannerContext } from './planningGeminiServer';
import type { RunAutoScheduleOutput } from '../scheduling/runAutoSchedule';
type Assignment = RunAutoScheduleOutput['assignments'][number];
export type PlannerSeed = {
    positions: Array<{
        positionName: string;
        qty?: number;
        shifts?: Array<{
            code: string;
            name?: string;
            hours?: number;
            startTime?: string;
            endTime?: string;
            days?: string[];
        }>;
        activeDays?: string[];
        coverageType?: string;
        excludedDates?: string[];
    }>;
    employees: Array<{
        id: string;
        nombre?: string;
    }>;
    days: string[];
    slaVendidas: number;
    absences: Record<string, string[]>;
};
export declare function buildPlannerContextFromScheduleResult(params: {
    mesLabel: string;
    objetivoNombre: string;
    seed: PlannerSeed;
    result: RunAutoScheduleOutput;
}): PlannerContext;
export declare function mergeGeminiCorrectionsIntoAssignments(assignments: Assignment[], correcciones: GeminiCorreccion[], positions: PlannerSeed['positions']): {
    assignments: Assignment[];
    applied: number;
    skipped: number;
};
export type OptimizeScheduleResult = {
    assignments: Assignment[];
    gemini: GeminiRespuesta | null;
    applied: number;
    skipped: number;
    usedAi: boolean;
    aiError?: string;
};
export declare function optimizeScheduleAssignmentsWithGemini(params: {
    mesLabel: string;
    objetivoNombre: string;
    seed: PlannerSeed;
    result: RunAutoScheduleOutput;
}): Promise<OptimizeScheduleResult>;
export {};
