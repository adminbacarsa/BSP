import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare function rebalanceHoursTowardSla(opts: {
    draft: VplanScheduleDraft;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    cycle?: string;
    dateStrList?: string[];
    slaVendidas: number;
    employeeIds: string[];
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
    tolerance?: number;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    hoursAdded: number;
};
