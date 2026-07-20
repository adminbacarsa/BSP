import type { VplanCoverageManifest, VplanDayDemand, VplanPlanningTarget } from './vplan.types';
export declare function buildVplanCoverageManifest(opts: {
    dayDemands: VplanDayDemand[];
    planningTarget: VplanPlanningTarget;
}): VplanCoverageManifest;
export declare function countFilledSlotsFromAssignments(opts: {
    assignments: Array<{
        employeeId: string;
        dateStr: string;
        code: string;
        positionName?: string;
    }>;
    defaultPositionByEmp: Record<string, string>;
    manifest: VplanCoverageManifest;
}): {
    filledSlots: number;
    missingSlots: number;
    byPosition: VplanCoverageManifest['byPosition'];
};
