import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare function enforceCustomPositionSchedules(opts: {
    draft: VplanScheduleDraft;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    absences?: Record<string, Set<string>>;
    openingSlotByEmp?: Record<string, number>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function detectOverlongWorkStreaks(draft: VplanScheduleDraft, dateStrs: string[], maxWorkDays?: number): Array<{
    employeeId: string;
    band: string;
    fromDate: string;
    toDate: string;
    days: number;
}>;
export declare function detectConsecutiveBillableHoursViolations(draft: VplanScheduleDraft, dateStrs: string[], maxHours: number): Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    hours: number;
}>;
export declare function isCustomEmployeeCrossAssignable(opts: {
    empId: string;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
}): boolean;
export declare function computeCustomScheduleProtectedCells(opts: {
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    draftAssignments?: VplanAssignment[];
}): Set<string>;
export declare function detectCustomScheduleViolations(opts: {
    draft: VplanScheduleDraft;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
}): Array<{
    employeeId: string;
    dateStr: string;
    expectedCode: string;
    actualCode: string;
    positionName: string;
}>;
export declare function detectOverlongRestStreaks(draft: VplanScheduleDraft, dateStrs: string[], cycle: string, previousMonthAssignments?: VplanExistingAssignment[], rules?: PlanningRulesConfig): Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    restDays: number;
    maxRest: number;
}>;
export declare function enforceMaxRestStreak(opts: {
    draft: VplanScheduleDraft;
    dateStrs: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp?: Record<string, string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
