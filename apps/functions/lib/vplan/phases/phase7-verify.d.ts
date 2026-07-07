import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanDemandModel, VplanScheduleDraft, VplanStrategy, VplanVerificationReport } from '../vplan.types';
export declare function runVplanVerification(opts: {
    snapshot: VplanPlanningSnapshot;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    strategy: VplanStrategy;
    draft: VplanScheduleDraft;
    monthDemandHours?: number;
    demand?: VplanDemandModel;
    employeeNames?: Record<string, string>;
    planningRules?: PlanningRulesConfig;
}): VplanVerificationReport;
