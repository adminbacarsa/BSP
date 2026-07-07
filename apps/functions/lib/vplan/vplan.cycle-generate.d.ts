import type { EngineContext } from '../scheduling/autoScheduleEngine';
import type { VplanPlanningState, VplanExistingAssignment } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import type { VplanAssignment } from './vplan.types';
export interface VplanSubgroupMeta {
    positionName: string;
    subgroupIndex: number;
    subgroupCount: number;
    employeeIds: string[];
}
export declare function resolveOpeningSlotsForVplan(opts: {
    cycle: string;
    prevPlanningState: VplanPlanningState;
    prevAssignments: VplanExistingAssignment[];
    prevMonthDateStrs: string[];
    monthFirstDate: string;
    engineSlots: Record<string, number>;
    useTrailing: boolean;
    positionGroups: Record<string, string[]>;
    positions: VplanPositionDef[];
}): {
    slots: Record<string, number>;
    trailingCount: number;
    historyCount: number;
};
export declare function generateCycleAssignments(opts: {
    ctx: EngineContext;
    positions: VplanPositionDef[];
    positionGroups: Record<string, string[]>;
    dateStrs: string[];
    openingSlotByEmp: Record<string, number>;
    cycle: string;
}): VplanAssignment[];
export declare function mergeCycleWithEngineAssignments(engineAssignments: VplanAssignment[], cycleAssignments: VplanAssignment[], openingSlotByEmp: Record<string, number>): VplanAssignment[];
export declare function inferOpeningSlotsFromHistory4x2(assignments: Array<{
    employeeId: string;
    dateStr: string;
    code: string;
}>, monthDateStrs: string[], targetMonthFirstDateStr: string): Record<string, number>;
export declare function generate4x2Assignments(opts: {
    ctx: EngineContext;
    positions: VplanPositionDef[];
    positionGroups: Record<string, string[]>;
    dateStrs: string[];
    openingSlotByEmp: Record<string, number>;
}): {
    assignments: VplanAssignment[];
    openingSlotByEmp: Record<string, number>;
};
export declare function is4x2CycleMode(cycle?: string): boolean;
