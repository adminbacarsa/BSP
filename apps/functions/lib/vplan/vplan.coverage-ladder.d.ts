import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import { type VplanPositionDef } from './vplan.positions';
import type { VplanDemandModel, VplanFixerLogEntry, VplanScheduleDraft } from './vplan.types';
export declare const NEEDS_REINFORCEMENT_EMP_ID = "SIN_COBERTURA";
export declare const NEEDS_REINFORCEMENT_CODE = "NR";
export interface FillCoverageLadderOpts {
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
    slaVendidas?: number;
    offerHours?: number;
    employeeIds?: string[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
}
export interface FillCoverageLadderResult {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    ladderStats: {
        subgrupo6x2: number;
        refuerzo4x2: number;
        sinTurno: number;
        ret: number;
        ft: number;
        needsReinforcement: number;
        bandSwap: number;
        auditGap: number;
    };
}
export interface FillAssignableGapsFromAuditOpts {
    draft: VplanScheduleDraft;
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    dateStrList: string[];
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
}
export declare function fillAssignableGapsFromAudit(opts: FillAssignableGapsFromAuditOpts): FillCoverageLadderResult;
export declare function fillCoverageGapsWithLadder(opts: FillCoverageLadderOpts): FillCoverageLadderResult;
