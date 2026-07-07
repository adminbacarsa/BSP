export type PlanningRulesStatus = 'ACTIVE' | 'INACTIVE';
export type PlanningCycleKey = '6+2' | '4+2' | '5+1' | '6+1';
export interface PlanningCycleRule {
    workDays: number;
    restDays: number;
    shiftHours: 8 | 12;
    enabled: boolean;
}
export interface PlanningRulesConfig {
    status: PlanningRulesStatus;
    updatedAt?: string;
    updatedBy?: string;
    cctMaxBillableHours: number;
    targetAvgHoursPerEmployee: number;
    minRestHoursBetweenBands: number;
    maxConsecutiveWorkHours: number;
    defaultCycle: PlanningCycleKey;
    cycles: Record<PlanningCycleKey, PlanningCycleRule>;
    solverMaxIterations: number;
    protectCoverageOnEnforce: boolean;
    slaHoursTolerance: number;
    coverageRatioMin: number;
}
