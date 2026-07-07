import { type VplanBrainAction, type VplanBrainReport } from '../vplan.brain';
import type { PlanningRulesConfig } from '../../planning/planning-rules.types';
import type { VplanExistingAssignment, VplanPlanningSnapshot, VplanPlanningState } from '../vplan.firestore';
import type { VplanPositionDef } from '../vplan.positions';
import type { VplanCoverageAuditReport, VplanDemandModel, VplanFixerLogEntry, VplanScheduleDraft, VplanStrategy } from '../vplan.types';
export declare function runVplanDeterministicFixer(draft: VplanScheduleDraft, dateStrs?: string[], opts?: {
    brainReport?: VplanBrainReport;
    action?: VplanBrainAction;
    previousMonthAssignments?: VplanExistingAssignment[];
    monthFirstDate?: string;
    positions?: VplanPositionDef[];
    dateMeta?: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    defaultPositionByEmp?: Record<string, string>;
    defaultShiftByEmp?: Record<string, string>;
    demand?: VplanDemandModel;
    cycle?: string;
    strategy?: VplanStrategy;
    snapshot?: VplanPlanningSnapshot;
    prevPlanningState?: VplanPlanningState;
    prevMonthLastDate?: string;
    employeeNames?: Record<string, string>;
    planningRules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    coverageAudit?: VplanCoverageAuditReport;
    action: VplanBrainAction;
};
