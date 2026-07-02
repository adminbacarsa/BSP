/**
 * VPLAN — tipos cliente (espejo de apps/functions/src/vplan/vplan.types.ts).
 * Mantener sincronizado al evolucionar el contrato. Ver docs/VPLAN.md
 */

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
