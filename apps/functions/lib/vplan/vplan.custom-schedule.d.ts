import { type VplanPositionDef } from './vplan.positions';
import type { VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
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
