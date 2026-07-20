import type { VplanRunMode, VplanStrategy } from '../vplan.types';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanPositionDef } from '../vplan.positions';
import type { VplanDemandModel, VplanFeasibilityReport, VplanSupplyModel } from '../vplan.types';
export declare function buildVplanStrategy(opts: {
    mode: VplanRunMode;
    preferredCycle?: string;
    hasExistingAssignments: boolean;
    hasTrailing: boolean;
    hasPrevMonthShifts?: boolean;
    demand?: VplanDemandModel;
    supply?: VplanSupplyModel;
    feasibility?: VplanFeasibilityReport;
    positions?: VplanPositionDef[];
    trailingEmployeeCount?: number;
    planningRules?: PlanningRulesConfig;
}): VplanStrategy;
