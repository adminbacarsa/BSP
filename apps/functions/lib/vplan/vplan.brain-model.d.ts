import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import type { VplanExistingAssignment } from './vplan.firestore';
import type { VplanAssignment, VplanDemandModel, VplanFeasibilityReport, VplanSupplyModel } from './vplan.types';
export declare const OBJECTIVE_CYCLE_DEFAULT: "6+2";
export declare const CONTINGENCY_CYCLE: "4+2";
export declare const HOURS_PER_CYCLE_BLOCK = 48;
export declare const COVERAGE_LADDER: readonly [{
    readonly step: 1;
    readonly key: "SUBGRUPO_6X2_LEGAL";
    readonly label: "Mismo subgrupo/puesto en F legal (6+2)";
    readonly cost: "normal";
    readonly breaks6x2: false;
}, {
    readonly step: 2;
    readonly key: "REFUERZO_4X2_OBJETIVO";
    readonly label: "Guardia del objetivo en ciclo 4+2 (12h) — requiere headroom de horas";
    readonly cost: "horas_extra_mismo_objetivo";
    readonly breaks6x2: false;
    readonly requiresHourHeadroom: true;
}, {
    readonly step: 3;
    readonly key: "SIN_TURNO_OBJETIVO";
    readonly label: "Personal sin turno asignado que conozca el objetivo";
    readonly cost: "asignacion_nueva";
    readonly breaks6x2: false;
}, {
    readonly step: 4;
    readonly key: "RET_OBJETIVO";
    readonly label: "Personal en RET (stand-by del objetivo)";
    readonly cost: "retencion";
    readonly breaks6x2: false;
}, {
    readonly step: 5;
    readonly key: "FT_FRANCO_TRABAJADO";
    readonly label: "Guardia del objetivo en Franco — FT (doble costo, última opción)";
    readonly cost: "doble_pago";
    readonly breaks6x2: true;
    readonly requiresValidation: true;
}];
export type CoverageLadderKey = typeof COVERAGE_LADDER[number]['key'];
export type PlanningLayerKey = 'CICLO_OBJETIVO' | 'CONTINGENCIA_4X2' | 'OFFSET_RACHA';
export interface PlanningLayerStatus {
    key: PlanningLayerKey;
    label: string;
    value: string;
    notes: string;
}
export interface HourHeadroom {
    slaVendidas: number;
    billableHours: number;
    offerHours: number;
    gapToSla: number;
    headroomHours: number;
    canUseContingency4x2: boolean;
    summary: string;
    employeeCount?: number;
    avgHoursRequiredPerGuard?: number;
    avgHoursOfferPerGuard?: number;
    assignmentGapNotHeadcount?: boolean;
}
export interface CoverageLadderRecommendation {
    dateStr: string;
    positionName: string;
    shiftCode: string;
    ladderStep: CoverageLadderKey;
    stepNumber: number;
    message: string;
    employeeId?: string;
}
export declare function describePlanningLayers(opts: {
    objectiveCycle: string;
    useTrailing: boolean;
    trailingEmployeeCount: number;
    hourHeadroom: HourHeadroom;
}): PlanningLayerStatus[];
export declare function assessCapacityVsSla(opts: {
    employeeCount: number;
    slaVendidas: number;
    offerHours: number;
    targetAvgHoursPerEmployee?: number;
    tolerance?: number;
}): {
    avgHoursRequiredPerGuard: number;
    avgHoursOfferPerGuard: number;
    capacityAdequate: boolean;
    summary: string;
};
export declare function computeHourHeadroom(opts: {
    slaVendidas: number;
    billableHours: number;
    offerHours?: number;
    tolerance?: number;
    employeeCount?: number;
    targetAvgHoursPerEmployee?: number;
}): HourHeadroom;
export declare function candidateLegalFor6x2(opts: {
    assignments: VplanAssignment[];
    dateStrList: string[];
    empId: string;
    dateStr: string;
    shiftCode: string;
    cycle: string;
    previousMonthAssignments?: VplanExistingAssignment[];
    rules?: PlanningRulesConfig;
}): boolean;
export declare function recommendCoverageLadderStep(opts: {
    hourHeadroom: HourHeadroom;
    hasRetAvailable?: boolean;
    hasUnassignedPool?: boolean;
    onlyFtLeft?: boolean;
}): CoverageLadderKey;
export declare function ladderMessage(step: CoverageLadderKey, dateStr: string, positionName: string, shiftCode: string): string;
export declare function maxWorkDaysForPlanningCycle(cycle: string, rules?: PlanningRulesConfig): number;
export declare function buildFeasibilityHourOffer(demand?: VplanDemandModel, supply?: VplanSupplyModel, feasibility?: VplanFeasibilityReport): number;
