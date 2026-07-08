import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import { type CoverageGuardContext } from './vplan.coverage-guard';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare function trailingWorkFromPrevMonth(prev: VplanExistingAssignment[] | undefined, empId: string, cycle: string): number;
export declare function trailingRestFromPrevMonth(prev: VplanExistingAssignment[] | undefined, empId: string): number;
export declare function wouldExceedCctWorkStreak(opts: {
    assignments: VplanAssignment[];
    dateStrs: string[];
    empId: string;
    dateStr: string;
    shiftCode: string;
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
    allowFrancoTrabajado?: boolean;
}): {
    ok: boolean;
    reason?: string;
};
export declare function enforceCctWorkRestPattern(opts: {
    draft: VplanScheduleDraft;
    dateStrs: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    skipCustomCodes?: Set<string>;
    rules?: PlanningRulesConfig;
    coverageGuard?: CoverageGuardContext & {
        protect: boolean;
    };
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function detectCctStreakViolations(opts: {
    draft: VplanScheduleDraft;
    dateStrs: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
}): Array<{
    employeeId: string;
    fromDate: string;
    toDate: string;
    workDays: number;
    expectedRest: number;
}>;
