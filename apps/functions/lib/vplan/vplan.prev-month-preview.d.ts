import type { VplanPlanningSnapshot } from './vplan.firestore';
import type { VplanPrevMonthPreview } from './vplan.types';
export declare function buildPrevMonthTrailingPreview(targetYear: number, targetMonth: number, snapshot: VplanPlanningSnapshot): VplanPrevMonthPreview;
