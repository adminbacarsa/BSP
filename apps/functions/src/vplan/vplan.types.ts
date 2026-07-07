/**
 * VPLAN — tipos del cerebro de planificación (experimental, paralelo al legacy).
 * Fuente de verdad del contrato: docs/VPLAN.md
 */

import type { PlanningRulesConfig } from '../planning/planning-rules.types';

export type { PlanningRulesConfig };

/** Modos de corrida del orquestador. */
export type VplanRunMode =
  | 'GREENFIELD'
  | 'CONTINUE'
  | 'COMPLETE'
  | 'RESTORE'
  | 'REPLAN_ABSENCES'
  | 'REBALANCE_HOURS'
  | 'MIGRATE_CYCLE';

/** Intents incrementales para probar etapas en emulador. */
export type VplanIntent =
  | 'intake'
  | 'demand'
  | 'supply'
  | 'feasibility'
  | 'strategy'
  | 'generate'
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
  /** Presupuesto horas: ciclo CCT (26→25) o mes calendario simple. */
  budgetMode?: 'cct' | 'calendar';
  /** Ciclo preferido si la viabilidad lo permite. */
  preferredCycle?: '6+2' | '4+2' | '5+1' | '6+1';
  /** Incluir Fase 9 (Gemini) — solo emulador con GEMINI_API_KEY. */
  runOptimization?: boolean;
  /** IDs empleados a considerar; vacío = según supplyScope. */
  employeeIds?: string[];
  /** objective = nativos del objetivo + planificación; empresa = toda plantilla activa. */
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
  /** SLA ÷ guardias — ej. 3413/18 ≈ 189h */
  avgHoursRequiredPerGuard?: number;
  /** Oferta estimada ÷ guardias — ej. 3456/18 = 192h */
  avgHoursOfferPerGuard?: number;
  /** Oferta plantilla ≥ SLA: no es problema de dotación */
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
    /** Horas del motor antes de CCT/ladder */
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
  uncoveredByDay: Record<string, Array<{ positionName: string; shiftCode: string; missing: number }>>;
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
  /** Hay guardias suficientes; el gap es de asignación/redistribución */
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

/** @deprecated Usar brainReport */
export interface VplanFixerDecision {
  policy: 'skip' | 'light' | 'preserve' | 'mandate_repair' | 'solver_full';
  reason: string;
  preserveGeneration: boolean;
}

/** Contexto que viaja entre fases — ver docs/VPLAN.md §5. */
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
  /** Reglas CCT/planificación cargadas desde planning_rules/{empresaId}. */
  planningRules?: PlanningRulesConfig;
}

export interface VplanRunResponse {
  version: 'VPLAN_0.2';
  status: 'ok' | 'feasibility_failed' | 'verification_failed' | 'error';
  context: VplanBrainContext;
  message: string;
}
