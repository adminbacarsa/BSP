import type { CoverageReport, EngineAssignment, EngineContext } from '../scheduling/autoScheduleEngine';
import type { VplanEmployeeRecord } from './vplan.firestore';
import type { VplanAssignment, VplanCodeMonthSummary, VplanOverCoverageDayGap, VplanPositionSlotRow, VplanSchedulePreview } from './vplan.types';
export declare function buildPositionSlotRows(ctx: EngineContext, assignments: VplanAssignment[]): VplanPositionSlotRow[];
export declare function buildSlaExpectedByCode(ctx: EngineContext): Record<string, number>;
export declare function buildOverCoveredByDay(ctx: EngineContext, assignments: VplanAssignment[]): {
    overCoveredByDay: Record<string, VplanOverCoverageDayGap[]>;
    overCoveredSlots: number;
};
export declare function buildCodeMonthSummary(assignments: VplanAssignment[], slaExpectedByCode?: Record<string, number>): VplanCodeMonthSummary[];
export declare function buildSchedulePreview(opts: {
    assignments: VplanAssignment[];
    employees: VplanEmployeeRecord[];
    dateStrs: string[];
    defaultPositionByEmp: Record<string, string>;
    slaExpectedByCode?: Record<string, number>;
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
    overCoveredSlots: number;
    coverageRatio: number;
    structuralHours: number;
    positionSlots: VplanPositionSlotRow[];
    uncoveredByDay: Record<string, {
        positionName: string;
        shiftCode: string;
        missing: number;
    }[]>;
    overCoveredByDay: Record<string, VplanOverCoverageDayGap[]>;
    schedulePreview: VplanSchedulePreview;
};
export declare function engineAssignmentsFromDraft(draft: VplanAssignment[]): EngineAssignment[];
