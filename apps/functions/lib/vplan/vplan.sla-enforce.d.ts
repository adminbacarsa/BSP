import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { VplanAssignment, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare function isVacanteId(empId: string): boolean;
export declare function normBandCode(code: string): string;
export declare function maxEmployeesForPosition(pos: VplanPositionDef, cycle?: string): number;
export declare function prioritizeEmployeeIds(empIds: string[], defaultPositionByEmp: Record<string, string>, posName: string): string[];
export declare function capDefaultPositionByEmp(positions: VplanPositionDef[], map: Record<string, string>, cycle?: string): Record<string, string>;
export declare function resolvePositionAssignees(opts: {
    defaultPositionByEmp: Record<string, string>;
    positions: VplanPositionDef[];
    cycle?: string;
    draftAssignments?: VplanAssignment[];
    onlyCustom?: boolean;
}): Map<string, string>;
export declare function stripExcessSlaAssignments(opts: {
    draft: VplanScheduleDraft;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp?: Record<string, string>;
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export declare function fillCoverageGaps(opts: {
    draft: VplanScheduleDraft;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    cycle?: string;
    dateStrList?: string[];
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
