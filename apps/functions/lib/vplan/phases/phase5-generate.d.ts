import type { VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanScheduleDraft, VplanStrategy } from '../vplan.types';
export declare function runVplanGeneration(opts: {
    snapshot: VplanPlanningSnapshot;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    strategy: VplanStrategy;
}): VplanScheduleDraft;
