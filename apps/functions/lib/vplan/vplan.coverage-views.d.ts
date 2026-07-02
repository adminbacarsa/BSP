import type { CoverageReport, EngineAssignment, EngineContext } from '../scheduling/autoScheduleEngine';
import type { VplanEmployeeRecord } from './vplan.firestore';
import type { VplanAssignment, VplanCodeMonthSummary, VplanPositionSlotRow, VplanSchedulePreview } from './vplan.types';
export declare function buildPositionSlotRows(ctx: EngineContext, assignments: VplanAssignment[]): VplanPositionSlotRow[];
export declare function buildCodeMonthSummary(assignments: VplanAssignment[]): VplanCodeMonthSummary[];
export declare function buildSchedulePreview(opts: {
    assignments: VplanAssignment[];
    employees: VplanEmployeeRecord[];
    dateStrs: string[];
    defaultPositionByEmp: Record<string, string>;
}): VplanSchedulePreview;
export declare function buildVplanCoverageBundle(opts: {
    ctx: EngineContext;
    draftAssignments: VplanAssignment[];
    coverage: CoverageReport;
    employees: VplanEmployeeRecord[];
    monthDemandHours: number;
    defaultPositionByEmp: Record<string, string>;
    dateStrs: string[];
}): {
    totalSlots: number;
    coveredSlots: number;
    uncoveredSlots: number;
    coverageRatio: number;
    structuralHours: number;
    positionSlots: VplanPositionSlotRow[];
    uncoveredByDay: Record<string, {
        positionName: string;
        shiftCode: string;
        missing: number;
    }[]>;
    schedulePreview: VplanSchedulePreview;
};
export declare function engineAssignmentsFromDraft(draft: VplanAssignment[]): EngineAssignment[];
