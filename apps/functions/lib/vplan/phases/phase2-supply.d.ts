import type { VplanSupplyModel } from '../vplan.types';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanEmployeeRecord } from '../vplan.firestore';
export declare function buildVplanSupplyModel(opts: {
    employees: VplanEmployeeRecord[];
    days: Array<{
        dateStr: string;
    }>;
    absences: Record<string, Set<string>>;
    suggestedHeadcount?: number;
    previousMonthStateKey?: string;
    planningRules?: PlanningRulesConfig;
}): VplanSupplyModel;
export declare function estimateOfferHours(supply: VplanSupplyModel, avgShiftHours?: number, workRatio?: number, cctMaxFallback?: number): number;
