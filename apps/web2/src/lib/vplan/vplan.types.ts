/**
 * VPLAN — tipos cliente (espejo de apps/functions/src/vplan/vplan.types.ts).
 * Mantener sincronizado al evolucionar el contrato. Ver docs/VPLAN.md
 */

export type VplanRunMode =
  | 'GREENFIELD'
  | 'CONTINUE'
  | 'COMPLETE'
  | 'RESTORE'
  | 'REPLAN_ABSENCES'
  | 'REBALANCE_HOURS'
  | 'MIGRATE_CYCLE';

export type VplanIntent =
  | 'intake'
  | 'demand'
  | 'supply'
  | 'feasibility'
  | 'strategy'
  | 'generate'
  | 'coverage'
  | 'exceptions'
  | 'verify'
  | 'fix'
  | 'optimize'
  | 'full';

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

/** Regla por puesto: qty pax → bandas exigidas cada día activo */
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
  parts: Array<{ positionName: string; count: number }>;
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

/** Objetivo de cobertura — lo primero que VPLAN debe entender antes de generar */
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
    motorBillableHours?: number;
    continuityFixes?: number;
    trailingSlotCount?: number;
    needsReinforcementCount?: number;
    slotCoverage?: {
      ok: boolean;
      filledSlots: number;
      missingSlots: number;
      excessSlots: number;
      totalRequired: number;
      summaryLabel: string;
      iterations: number;
      byPosition: VplanCoverageManifest['byPosition'];
    };
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
  planningMethod?: VplanPlanningMethod;
  cycleSemantics?: VplanCycleSemantics;
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
  excessSlots?: number;
  assignedSlots?: number;
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

export interface VplanCoverageBundle {
  totalSlots: number;
  coveredSlots: number;
  uncoveredSlots: number;
  overCoveredSlots?: number;
  coverageRatio: number;
  structuralHours: number;
  positionSlots: VplanPositionSlotRow[];
  uncoveredByDay: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>>;
  overCoveredByDay?: Record<string, VplanOverCoverageDayGap[]>;
  schedulePreview: VplanSchedulePreview;
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
  tailDays: Array<{ dateStr: string; code: string }>;
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
