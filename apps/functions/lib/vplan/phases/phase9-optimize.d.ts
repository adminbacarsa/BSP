import type { VplanDemandModel, VplanOptimizationResult, VplanScheduleDraft, VplanSupplyModel, VplanVerificationReport } from '../vplan.types';
import type { VplanPlanningSnapshot } from '../vplan.firestore';
export declare function runVplanOptimization(opts: {
    enabled: boolean;
    snapshot: VplanPlanningSnapshot;
    demand: VplanDemandModel;
    supply: VplanSupplyModel;
    draft: VplanScheduleDraft;
    verification: VplanVerificationReport;
}): Promise<{
    result: VplanOptimizationResult;
    draft: VplanScheduleDraft;
}>;
