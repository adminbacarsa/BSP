import type { VplanDemandModel, VplanFeasibilityReport, VplanSupplyModel } from '../vplan.types';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanPositionDef } from '../vplan.positions';
export declare function buildVplanFeasibilityReport(opts: {
    demand: VplanDemandModel;
    supply: VplanSupplyModel;
    positions: VplanPositionDef[];
    days: Array<{
        dayLetter: string;
    }>;
    preferredCycle?: string;
    budgetMode?: 'cct' | 'calendar';
    planningRules?: PlanningRulesConfig;
}): VplanFeasibilityReport;
