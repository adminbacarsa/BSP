export type VplanRunMode = 'GREENFIELD' | 'CONTINUE' | 'COMPLETE' | 'RESTORE' | 'REPLAN_ABSENCES' | 'REBALANCE_HOURS' | 'MIGRATE_CYCLE';
export type VplanIntent = 'intake' | 'demand' | 'supply' | 'feasibility' | 'strategy' | 'generate' | 'exceptions' | 'verify' | 'fix' | 'optimize' | 'full';
export interface VplanRunRequest {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    mode: VplanRunMode;
    intent?: VplanIntent;
    budgetMode?: 'cct' | 'calendar';
    preferredCycle?: '6+2' | '4+2' | '5+1' | '6+1';
    runOptimization?: boolean;
    employeeIds?: string[];
}
export interface VplanPositionDemand {
    positionName: string;
    qty: number;
    coverageType: string;
    schemeLabel: string;
    hoursRequired: number;
    bandSlots: Record<string, number>;
}
export interface VplanDayDemand {
    dateStr: string;
    dayLetter: string;
    positions: VplanPositionDemand[];
    totalPaxUnits: number;
    hoursRequired: number;
}
export interface VplanDemandModel {
    slaVendidas: number;
    monthDemandHours: number;
    hoursDelta: number;
    dayDemands: VplanDayDemand[];
    monthBandDemand: Record<string, number>;
    warnings: string[];
}
export interface VplanEmployeeAvailability {
    employeeId: string;
    displayName: string;
    blockedDates: string[];
    availableDays: number;
    cctHoursUsed?: number;
    cctHoursRemaining?: number;
}
export interface VplanSupplyModel {
    employeeCount: number;
    employees: VplanEmployeeAvailability[];
    suggestedHeadcount?: number;
    previousMonthSnapshotId?: string;
}
export interface VplanFeasibilityReport {
    ok: boolean;
    reasons: string[];
    suggestedCycle?: string;
    suggestedHeadcount?: number;
    peakConcurrent?: number;
}
export interface VplanAssignment {
    employeeId: string;
    dateStr: string;
    code: string;
    positionName: string;
    hours?: number;
}
export interface VplanScheduleDraft {
    assignments: VplanAssignment[];
    sourceEngine?: string;
}
export interface VplanVerificationIssue {
    severity: 'blocking' | 'warning' | 'info';
    code: string;
    message: string;
    dateStr?: string;
    positionName?: string;
    employeeId?: string;
}
export interface VplanVerificationReport {
    ok: boolean;
    issues: VplanVerificationIssue[];
    billableHours?: number;
    slaVendidas?: number;
    hoursGap?: number;
}
export interface VplanStepResult {
    phase: string;
    ok: boolean;
    summary: string;
    durationMs?: number;
}
export interface VplanBrainContext {
    run: VplanRunRequest;
    demand?: VplanDemandModel;
    supply?: VplanSupplyModel;
    feasibility?: VplanFeasibilityReport;
    draft?: VplanScheduleDraft;
    verification?: VplanVerificationReport;
    steps: VplanStepResult[];
}
export interface VplanRunResponse {
    version: 'VPLAN_0.1';
    status: 'stub' | 'ok' | 'feasibility_failed' | 'error';
    context: VplanBrainContext;
    message: string;
}
