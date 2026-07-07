import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { type CoverageLadderRecommendation, type HourHeadroom, type PlanningLayerStatus } from './vplan.brain-model';
import type { VplanExistingAssignment, VplanPlanningSnapshot, VplanPlanningState } from './vplan.firestore';
import type { VplanPositionDef } from './vplan.positions';
import type { VplanDemandModel, VplanFeasibilityReport, VplanFixerLogEntry, VplanRunMode, VplanScheduleDraft, VplanStrategy, VplanSupplyModel } from './vplan.types';
export type VplanMandateKey = 'CICLO_6X2' | 'COBERTURA_OBJETIVO' | 'HORAS_VENDIDAS';
export type VplanBrainAction = 'skip' | 'preserve' | 'mandate_repair' | 'solver_full';
export interface VplanMandateStatus {
    key: VplanMandateKey;
    label: string;
    ok: boolean;
    summary: string;
}
export interface VplanBrainReport {
    mandates: VplanMandateStatus[];
    mandatesOk: number;
    mandatesTotal: number;
    allMandatesOk: boolean;
    action: VplanBrainAction;
    summary: string;
    preserveGeneration: boolean;
    repairTargets: VplanMandateKey[];
    planningLayers: PlanningLayerStatus[];
    hourHeadroom: HourHeadroom;
    coverageLadder: CoverageLadderRecommendation[];
    inMonthStreakViolations: number;
    crossMonthViolations: number;
}
export interface VplanBrainEvaluateOpts {
    mode: VplanRunMode;
    strategy: VplanStrategy;
    draft: VplanScheduleDraft;
    demand: VplanDemandModel;
    snapshot: VplanPlanningSnapshot;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
    prevMonthLastDate: string;
    monthFirstDate: string;
    dateStrList?: string[];
    supply?: VplanSupplyModel;
    feasibility?: VplanFeasibilityReport;
    planningRules?: PlanningRulesConfig;
}
export declare function evaluateVplanBrainMandates(opts: VplanBrainEvaluateOpts): VplanBrainReport;
export declare function applyLightPositionTagFixes(opts: {
    draft: VplanScheduleDraft;
    defaultPositionByEmp: Record<string, string>;
    protectedCells?: Set<string>;
}): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
export interface VplanBrainRepairOpts {
    brain: VplanBrainReport;
    draft: VplanScheduleDraft;
    dateStrList: string[];
    dateMeta: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    demand: VplanDemandModel;
    positions: VplanPositionDef[];
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
    cycle: string;
    strategy: VplanStrategy;
    snapshot: VplanPlanningSnapshot;
    prevPlanningState: VplanPlanningState;
    prevMonthLastDate: string;
    monthFirstDate: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    employeeNames?: Record<string, string>;
    planningRules?: PlanningRulesConfig;
    protectedCells?: Set<string>;
}
export declare function runBrainMandateRepair(opts: VplanBrainRepairOpts): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    coverageAudit?: import('./vplan.types').VplanCoverageAuditReport;
};
