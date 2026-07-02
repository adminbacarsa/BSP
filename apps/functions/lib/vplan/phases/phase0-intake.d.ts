import type { VplanIntakeMeta, VplanRunRequest } from '../vplan.types';
import type { VplanPlanningSnapshot } from '../vplan.firestore';
export declare function buildVplanIntake(request: VplanRunRequest, snapshot: VplanPlanningSnapshot): VplanIntakeMeta;
export declare function validateVplanRequest(request: VplanRunRequest): string | null;
