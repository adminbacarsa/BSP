import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanScheduleDraft, VplanStrategy, VplanVerificationReport } from '../vplan.types';
export declare function runVplanVerification(opts: {
    snapshot: VplanPlanningSnapshot;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    strategy: VplanStrategy;
    draft: VplanScheduleDraft;
}): VplanVerificationReport;
