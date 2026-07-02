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
    warnings?: string[];
    suggestedCycle?: string;
    suggestedHeadcount?: number;
    peakConcurrent?: number;
    peopleAvailable?: number;
    offerHours?: number;
    effectiveTargetHours?: number;
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
    stats?: {
        totalBillableHours: number;
        targetHours: number;
        slaHoursClosed: boolean;
        employeeCount: number;
    };
}
export interface VplanStrategy {
    cycle: string;
    absenceTiming: 'pre_block' | 'post_replan' | 'hybrid';
    continuity: 'continue_streaks' | 'reset';
    engine: string;
    modes: {
        useTrailing: boolean;
        preserveExisting: boolean;
        patchAbsencesPostGenerate: boolean;
    };
    notes: string[];
}
export interface VplanOptimizationResult {
    applied: boolean;
    skippedReason?: string;
    correctionCount?: number;
    summary?: string;
}
export interface VplanFixerLogEntry {
    code: string;
    message: string;
    employeeId?: string;
    dateStr?: string;
}
export interface VplanScheduleDiffEntry {
    action: 'create' | 'update' | 'delete';
    employeeId: string;
    dateStr: string;
    code: string;
    positionName: string;
    hours?: number;
    previousCode?: string;
}
export interface VplanDeliverable {
    diff: VplanScheduleDiffEntry[];
    reportSummary: string;
    assignmentCount: number;
    billableHours: number;
    uncoveredSlots?: number;
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
export interface VplanIntakeMeta {
    empresaId: string;
    objectiveId: string;
    objectiveName?: string;
    slaId: string;
    year: number;
    month: number;
    mode: VplanRunMode;
    positionCount: number;
    employeeCount: number;
    monthDays: number;
    budgetMode: 'cct' | 'calendar';
    preferredCycle: string;
}
export interface VplanBrainContext {
    run: VplanRunRequest;
    intake?: VplanIntakeMeta;
    demand?: VplanDemandModel;
    supply?: VplanSupplyModel;
    feasibility?: VplanFeasibilityReport;
    strategy?: VplanStrategy;
    draft?: VplanScheduleDraft;
    verification?: VplanVerificationReport;
    fixerLog?: VplanFixerLogEntry[];
    optimization?: VplanOptimizationResult;
    deliverable?: VplanDeliverable;
    steps: VplanStepResult[];
}
export interface VplanRunResponse {
    version: 'VPLAN_0.2';
    status: 'ok' | 'feasibility_failed' | 'verification_failed' | 'error';
    context: VplanBrainContext;
    message: string;
}
