import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanScheduleDraft, VplanStrategy, VplanDemandModel } from '../vplan.types';
export declare function runVplanGeneration(opts: {
    snapshot: VplanPlanningSnapshot;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    strategy: VplanStrategy;
    planningRules?: PlanningRulesConfig;
    demand?: VplanDemandModel;
}): VplanScheduleDraft;
