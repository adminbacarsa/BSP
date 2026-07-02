import type { EngineAssignment, EngineContext, EnginePositionDef } from '../scheduling/autoScheduleEngine';
import type { VplanPlanningSnapshot, VplanPlanningState } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import type { VplanStrategy } from './vplan.types';
export declare function toEnginePositions(positions: VplanPositionDef[]): EnginePositionDef[];
export declare function buildCodeHoursHint(positions: VplanPositionDef[]): Record<string, number>;
export declare function buildEngineContext(opts: {
    snapshot: VplanPlanningSnapshot;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    strategy: VplanStrategy;
    cctCutoffDay?: number;
}): EngineContext;
export declare function engineToVplanAssignments(assignments: EngineAssignment[]): Array<{
    employeeId: string;
    dateStr: string;
    code: string;
    positionName: string;
    hours?: number;
}>;
