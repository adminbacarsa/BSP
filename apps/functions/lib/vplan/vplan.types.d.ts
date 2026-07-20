import type { PlanningRulesConfig } from '../planning/planning-rules.types';
export type { PlanningRulesConfig };
export type VplanRunMode = 'GREENFIELD' | 'CONTINUE' | 'COMPLETE' | 'RESTORE' | 'REPLAN_ABSENCES' | 'REBALANCE_HOURS' | 'MIGRATE_CYCLE';
export type VplanIntent = 'intake' | 'demand' | 'supply' | 'feasibility' | 'strategy' | 'generate' | 'coverage' | 'exceptions' | 'verify' | 'fix' | 'optimize' | 'full';
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
    supplyScope?: 'objective' | 'empresa';
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
export interface VplanPositionPlanningRule {
    positionName: string;
    qty: number;
    coverageType: string;
    schemeLabel: string;
    activeDaysLabel: string;
    dailyBandsLabel: string;
    dailyRequirementLabel: string;
    slotsPerActiveDay: number;
    dailyHours: number;
    monthlySlotsByBand: Record<string, number>;
    monthlyTotalSlots: number;
    activeDayCount: number;
    monthlyFormulaLabel: string;
}
export interface VplanMonthBandRollup {
    band: string;
    total: number;
    parts: Array<{
        positionName: string;
        count: number;
    }>;
    label: string;
}
export interface VplanDayTypeExample {
    label: string;
    dateStr: string;
    dayLetter: string;
    positions: Array<{
        positionName: string;
        qty: number;
        bandSlots: Record<string, number>;
        hoursRequired: number;
        requirementLabel: string;
    }>;
    totalSlots: number;
    totalHours: number;
    summaryLabel: string;
}
export interface VplanPlanningTarget {
    headline: string;
    summary: string;
    totalMonthlySlots: number;
    totalMonthlyHours: number;
    monthBandDemand: Record<string, number>;
    positionRules: VplanPositionPlanningRule[];
    dayTypeExamples: VplanDayTypeExample[];
    slotArithmeticLines: string[];
    totalFormulaLabel: string;
    monthBandRollup: VplanMonthBandRollup[];
}
export interface VplanCoverageManifestSlot {
    id: string;
    dateStr: string;
    dayLetter: string;
    positionName: string;
    band: string;
    unitIndex: number;
    shiftCode: string;
}
export interface VplanCoverageManifest {
    totalRequiredSlots: number;
    totalRequiredHours: number;
    slots: VplanCoverageManifestSlot[];
    byPosition: Array<{
        positionName: string;
        qty: number;
        requiredSlots: number;
        filledSlots: number;
        missingSlots: number;
        dailyBandsLabel: string;
        activeDayCount: number;
    }>;
    summaryLabel: string;
}
export interface VplanSlotCoverageResult {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
    ok: boolean;
    iterations: number;
    totalRequired: number;
    filledSlots: number;
    missingSlots: number;
    excessSlots: number;
    byPosition: VplanCoverageManifest['byPosition'];
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
    summaryLabel: string;
}
export interface VplanDemandModel {
    slaVendidas: number;
    monthDemandHours: number;
    hoursDelta: number;
    dayDemands: VplanDayDemand[];
    monthBandDemand: Record<string, number>;
    warnings: string[];
    planningTarget: VplanPlanningTarget;
    coverageManifest: VplanCoverageManifest;
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
    avgHoursRequiredPerGuard?: number;
    avgHoursOfferPerGuard?: number;
    capacityAdequate?: boolean;
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
        continuityFixes?: number;
        openingSlotCount?: number;
        openingSlotByEmp?: Record<string, number>;
        openingProtectedCells?: string[];
        historySlotCount?: number;
        trailingSlotCount?: number;
        needsReinforcementCount?: number;
        motorBillableHours?: number;
        hourRebalanceAdded?: number;
        coverageLadder?: {
            subgrupo6x2: number;
            refuerzo4x2: number;
            sinTurno: number;
            ret: number;
            ft: number;
            needsReinforcement: number;
        };
        slotCoverage?: Pick<VplanSlotCoverageResult, 'ok' | 'filledSlots' | 'missingSlots' | 'excessSlots' | 'totalRequired' | 'summaryLabel' | 'iterations'> & {
            byPosition: VplanCoverageManifest['byPosition'];
        };
    };
}
export interface VplanCycleDefinition {
    cycleKey: string;
    workTurnCount: number;
    restFrancoCount: number;
    francoHours: number;
    minRestHoursBetweenTurns: number;
    patternExample: string;
    unitLabel: string;
    notCalendarDays: string;
    shiftHours: number;
    workBlockHours: number;
    hoursFormula: string;
    standardBlockHours: number;
    stretchBlockHours: number;
}
export interface VplanCycleSemantics {
    headline: string;
    inviolableRules: Array<{
        id: string;
        priority: number;
        label: string;
        rule: string;
    }>;
    shiftTypes: Array<{
        group: '8h' | '12h';
        codes: string[];
        hoursEach: number;
        label: string;
        dailyCoverageNote: string;
    }>;
    dailyCoverageEquivalence: {
        hoursPerDay: number;
        formula8h: string;
        formula12h: string;
        summary: string;
    };
    blockPatterns: Array<{
        id: string;
        label: string;
        pattern: string;
        totalWorkHours: number;
        hoursFormula: string;
        restFrancos: number;
        valid: boolean;
        note: string;
    }>;
    cycleDefinition: VplanCycleDefinition;
    cycleVsCoverage: {
        cycleLabel: string;
        coverageLabel: string;
        relationship: string;
    };
    planningOrder: Array<{
        order: number;
        key: string;
        label: string;
    }>;
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
    planningMethod?: VplanPlanningMethod;
    cycleSemantics?: VplanCycleSemantics;
}
export interface VplanPlanningMethodMandate {
    order: number;
    key: string;
    label: string;
    rule: string;
}
export interface VplanPlanningMethodPipelineStep {
    step: number;
    phase: string;
    title: string;
    description: string;
}
export interface VplanPlanningMethodPositionRule {
    positionName: string;
    assignmentMode: '24hs_rotativo' | 'custom_fijo';
    qty: number;
    headline: string;
    description: string;
}
export interface VplanPlanningMethod {
    headline: string;
    summary: string;
    engine: string;
    cycle: string;
    mode: VplanRunMode;
    mandates: VplanPlanningMethodMandate[];
    layers: Array<{
        key: 'CICLO_OBJETIVO' | 'CONTINGENCIA_4X2' | 'OFFSET_RACHA';
        label: string;
        value: string;
        notes: string;
    }>;
    pipelineSteps: VplanPlanningMethodPipelineStep[];
    positionRules: VplanPlanningMethodPositionRule[];
    coverageLadder: Array<{
        step: number;
        key: string;
        label: string;
        when: string;
    }>;
    rotationProfile: {
        subgroupSize: number;
        workersPerDay: number;
        francosPerDay: number;
        shiftHours: number;
        workBlockDays: number;
        restBlockDays: number;
    };
    strategyNotes: string[];
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
    employeeName?: string;
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
export interface VplanPositionSlotRow {
    positionName: string;
    shiftCode: string;
    requiredSlots: number;
    coveredSlots: number;
    missingSlots: number;
    excessSlots: number;
    assignedSlots: number;
    coveragePct: number;
}
export interface VplanCodeMonthSummary {
    code: string;
    label: string;
    category: 'trabajo' | 'franco' | 'ausencia' | 'otro';
    count: number;
    hours: number;
    slaExpected?: number;
    excessCount?: number;
}
export interface VplanOverCoverageDayGap {
    positionName: string;
    shiftCode: string;
    excess: number;
    employeeIds: string[];
}
export interface VplanCoverageBundle {
    totalSlots: number;
    coveredSlots: number;
    uncoveredSlots: number;
    overCoveredSlots: number;
    coverageRatio: number;
    structuralHours: number;
    positionSlots: VplanPositionSlotRow[];
    uncoveredByDay: Record<string, Array<{
        positionName: string;
        shiftCode: string;
        missing: number;
    }>>;
    overCoveredByDay: Record<string, VplanOverCoverageDayGap[]>;
    schedulePreview: VplanSchedulePreview;
}
export interface VplanSchedulePreviewCell {
    code: string;
    positionName?: string;
}
export interface VplanSchedulePreviewRow {
    employeeId: string;
    displayName: string;
    defaultPosition?: string;
    cells: Record<string, VplanSchedulePreviewCell>;
    codeTotals: Record<string, number>;
}
export interface VplanSchedulePreview {
    dateStrs: string[];
    rows: VplanSchedulePreviewRow[];
    codeSummary: VplanCodeMonthSummary[];
}
export interface VplanCoverageGapCandidate {
    employeeId: string;
    displayName?: string;
    currentCode: string;
    canAssign: boolean;
    blockReason?: string;
}
export interface VplanCoverageGapDetail {
    dateStr: string;
    dayLetter: string;
    positionName: string;
    shiftCode: string;
    required: number;
    assigned: number;
    missing: number;
    candidates: VplanCoverageGapCandidate[];
}
export interface VplanCoverageAuditReport {
    ok: boolean;
    totalGaps: number;
    totalMissingSlots: number;
    totalExcessSlots: number;
    gaps: VplanCoverageGapDetail[];
    iterationsUsed?: number;
}
export interface VplanVerificationReport {
    ok: boolean;
    issues: VplanVerificationIssue[];
    billableHours?: number;
    slaVendidas?: number;
    hoursGap?: number;
    coverage?: VplanCoverageBundle;
    coverageAudit?: VplanCoverageAuditReport;
}
export interface VplanStepResult {
    phase: string;
    ok: boolean;
    summary: string;
    durationMs?: number;
}
export interface VplanPrevMonthPreviewRow {
    employeeId: string;
    displayName: string;
    lastDate?: string;
    lastCode?: string;
    trailingWork?: number;
    trailingRest?: number;
    tailDays: Array<{
        dateStr: string;
        code: string;
    }>;
}
export interface VplanPrevMonthPreview {
    prevYear: number;
    prevMonth: number;
    prevMonthKey: string;
    assignmentCount: number;
    employeesWithTrailing: number;
    tailDateStrs: string[];
    rows: VplanPrevMonthPreviewRow[];
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
    prevMonthPreview?: VplanPrevMonthPreview;
}
export type VplanMandateKey = 'CICLO_6X2' | 'COBERTURA_OBJETIVO' | 'HORAS_VENDIDAS';
export interface VplanMandateStatus {
    key: VplanMandateKey;
    label: string;
    ok: boolean;
    summary: string;
}
export interface VplanPlanningLayerStatus {
    key: 'CICLO_OBJETIVO' | 'CONTINGENCIA_4X2' | 'OFFSET_RACHA';
    label: string;
    value: string;
    notes: string;
}
export interface VplanHourHeadroom {
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
export interface VplanCoverageLadderRecommendation {
    dateStr: string;
    positionName: string;
    shiftCode: string;
    ladderStep: string;
    stepNumber: number;
    message: string;
    employeeId?: string;
}
export interface VplanBrainReport {
    mandates: VplanMandateStatus[];
    mandatesOk: number;
    mandatesTotal: number;
    allMandatesOk: boolean;
    action: 'skip' | 'preserve' | 'mandate_repair' | 'solver_full';
    summary: string;
    preserveGeneration: boolean;
    repairTargets: VplanMandateKey[];
    planningLayers: VplanPlanningLayerStatus[];
    hourHeadroom: VplanHourHeadroom;
    coverageLadder: VplanCoverageLadderRecommendation[];
    inMonthStreakViolations: number;
    crossMonthViolations: number;
}
export interface VplanFixerDecision {
    policy: 'skip' | 'light' | 'preserve' | 'mandate_repair' | 'solver_full';
    reason: string;
    preserveGeneration: boolean;
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
    brainReport?: VplanBrainReport;
    fixerDecision?: VplanFixerDecision;
    fixerLog?: VplanFixerLogEntry[];
    optimization?: VplanOptimizationResult;
    deliverable?: VplanDeliverable;
    steps: VplanStepResult[];
    planningRules?: PlanningRulesConfig;
}
export interface VplanRunResponse {
    version: 'VPLAN_0.2';
    status: 'ok' | 'feasibility_failed' | 'verification_failed' | 'error';
    context: VplanBrainContext;
    message: string;
}
