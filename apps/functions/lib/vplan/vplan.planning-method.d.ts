import { type VplanPositionDef } from './vplan.positions';
import type { VplanCycleSemantics, VplanDemandModel, VplanFeasibilityReport, VplanPlanningMethod, VplanRunMode, VplanStrategy, VplanSupplyModel } from './vplan.types';
export declare function buildVplanPlanningMethod(opts: {
    strategy: VplanStrategy;
    mode: VplanRunMode;
    demand?: VplanDemandModel;
    supply?: VplanSupplyModel;
    feasibility?: VplanFeasibilityReport;
    positions: VplanPositionDef[];
    trailingEmployeeCount?: number;
    cycleSemantics?: VplanCycleSemantics;
}): VplanPlanningMethod;
