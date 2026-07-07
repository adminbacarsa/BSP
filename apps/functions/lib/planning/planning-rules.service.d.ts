import type { PlanningRulesConfig } from './planning-rules.types';
export declare function resolvePlanningRules(raw?: Partial<PlanningRulesConfig> | null): PlanningRulesConfig;
export declare function loadPlanningRulesForEmpresa(empresaId: string): Promise<PlanningRulesConfig>;
export declare function planningRulesDocPath(empresaId: string): string;
