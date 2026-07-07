import type { VplanExistingAssignment } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanAssignment, VplanCoverageAuditReport, VplanDemandModel, VplanScheduleDraft } from './vplan.types';
export declare function evaluateCoverageCandidate(opts: {
    empId: string;
    dateStr: string;
    shiftCode: string;
    assignments: VplanAssignment[];
    dateStrs: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
}): {
    canAssign: boolean;
    blockReason?: string;
};
export declare function buildDetailedCoverageAudit(opts: {
    draft: VplanScheduleDraft;
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    dateStrs: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    employeeNames?: Record<string, string>;
    rules?: PlanningRulesConfig;
}): VplanCoverageAuditReport;
