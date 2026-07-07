import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { VplanCoverageAuditReport, VplanDemandModel, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare function runCoverageSolverLoop(opts: {
    draft: VplanScheduleDraft;
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    dateStrList: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    employeeNames?: Record<string, string>;
    maxIterations?: number;
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    audit: VplanCoverageAuditReport;
    iterations: number;
    ok: boolean;
};
export declare function runMandateCoverageRepair(opts: {
    draft: VplanScheduleDraft;
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    dateStrs: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    dateStrList: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    employeeNames?: Record<string, string>;
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
    maxIterations?: number;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    audit: VplanCoverageAuditReport;
};
