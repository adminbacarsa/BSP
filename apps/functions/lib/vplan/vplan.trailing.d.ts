import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanPlanningState } from './vplan.firestore';
export declare function deriveTrailingFromAssignments(assignments: VplanExistingAssignment[], monthDateStrs: string[]): Pick<VplanPlanningState, 'trailingWorkDays' | 'trailingRestDays' | 'lastShiftByEmp' | 'lastWorkBandBeforeRest'>;
export declare function planningStateHasTrailing(state: VplanPlanningState): boolean;
export declare function enrichPlanningStateWithTrailingFromTurnos(state: VplanPlanningState, prevAssignments: VplanExistingAssignment[], prevMonthDateStrs: string[]): VplanPlanningState;
