/**
 * VPLAN — modelo conceptual del cerebro (fuente de verdad de diseño).
 *
 * Tres capas DISTINTAS (no mezclar):
 *
 * 1. CICLO_OBJETIVO (6+2) — Regla de planificación del objetivo.
 *    Máx 6 días trab consecutivos → 2F. Turnos M/T/N 8h.
 *    Aplica a toda la plantilla titular.
 *
 * 2. CONTINGENCIA (4+2) — Recurso opcional D12/N12 12h, 4 trab → 2F.
 *    Mismas 48h/ciclo que 6+2 pero otro régimen. NO es “4 días seguidos
 *    que se ven en la grilla” — es asignación explícita de refuerzo.
 *    Solo si hay capacidad de horas en el objetivo (oferta > SLA o headroom).
 *
 * 3. OFFSET_RACHA (trailing) — Dónde está CADA guardia dentro de su 6+2
 *    al abrir el mes (herencia abril→mayo→junio). Videla no “arranca 4+2”:
 *    continúa su posición en el ciclo 6+2.
 *
 * Mandatos (orden de prioridad en planificación futura — RÍGIDO):
 *   1. CICLO_6X2 + racha mes anterior — INNEGOCIABLE (nunca 7º día)
 *   2. COBERTURA_OBJETIVO — slots SLA cubiertos
 *   3. HORAS_VENDIDAS — cerrar SLA vendidas
 *
 * Si (1) impide cerrar (2) o (3), escalar por COVERAGE_LADDER (no romper 6+2).
 */

import type { PlanningRulesConfig } from '../planning/planning-rules.types';
import { DEFAULT_PLANNING_RULES, workDaysForCycle } from '../planning/planning-rules.defaults';
import { detectCctStreakViolations, wouldExceedCctWorkStreak } from './vplan.cct-enforce';
import type { VplanExistingAssignment } from './vplan.firestore';
import type {
  VplanAssignment,
  VplanDemandModel,
  VplanFeasibilityReport,
  VplanSupplyModel,
} from './vplan.types';

/** Capa 1: ciclo normal del objetivo */
export const OBJECTIVE_CYCLE_DEFAULT = '6+2' as const;

/** Capa 2: ciclo de contingencia / refuerzo */
export const CONTINGENCY_CYCLE = '4+2' as const;

/** Horas por ciclo equivalentes (6×8 = 4×12 = 48) */
export const HOURS_PER_CYCLE_BLOCK = 48;

/**
 * Escalera de cobertura cuando no hay candidato 6+2 legal para un slot.
 * Orden estricto — no saltar escalones.
 */
export const COVERAGE_LADDER = [
  {
    step: 1,
    key: 'SUBGRUPO_6X2_LEGAL',
    label: 'Mismo subgrupo/puesto en F legal (6+2)',
    cost: 'normal',
    breaks6x2: false,
  },
  {
    step: 2,
    key: 'REFUERZO_4X2_OBJETIVO',
    label: 'Guardia del objetivo en ciclo 4+2 (12h) — requiere headroom de horas',
    cost: 'horas_extra_mismo_objetivo',
    breaks6x2: false,
    requiresHourHeadroom: true,
  },
  {
    step: 3,
    key: 'SIN_TURNO_OBJETIVO',
    label: 'Personal sin turno asignado que conozca el objetivo',
    cost: 'asignacion_nueva',
    breaks6x2: false,
  },
  {
    step: 4,
    key: 'RET_OBJETIVO',
    label: 'Personal en RET (stand-by del objetivo)',
    cost: 'retencion',
    breaks6x2: false,
  },
  {
    step: 5,
    key: 'FT_FRANCO_TRABAJADO',
    label: 'Guardia del objetivo en Franco — FT (doble costo, última opción)',
    cost: 'doble_pago',
    breaks6x2: true,
    requiresValidation: true,
  },
] as const;

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

export function describePlanningLayers(opts: {
  objectiveCycle: string;
  useTrailing: boolean;
  trailingEmployeeCount: number;
  hourHeadroom: HourHeadroom;
}): PlanningLayerStatus[] {
  return [
    {
      key: 'CICLO_OBJETIVO',
      label: 'Ciclo objetivo',
      value: opts.objectiveCycle,
      notes: 'Plantilla titular M/T/N 8h · máx 6 trab → 2F',
    },
    {
      key: 'CONTINGENCIA_4X2',
      label: 'Contingencia 4+2',
      value: opts.hourHeadroom.canUseContingency4x2 ? 'disponible' : 'sin headroom',
      notes: opts.hourHeadroom.canUseContingency4x2
        ? `Headroom ~${Math.round(opts.hourHeadroom.headroomHours)}h para refuerzo D12/N12`
        : 'No asignar 4+2 sin capacidad de horas en el objetivo',
    },
    {
      key: 'OFFSET_RACHA',
      label: 'Offset racha (trailing)',
      value: opts.useTrailing ? `${opts.trailingEmployeeCount} guardia(s)` : 'n/a',
      notes: opts.useTrailing
        ? 'Continuidad mes anterior — no reiniciar plantilla'
        : 'GREENFIELD / sin junio previo',
    },
  ];
}

export function assessCapacityVsSla(opts: {
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
} {
  const tolerance = opts.tolerance ?? 8;
  const n = Math.max(0, opts.employeeCount);
  const sla = Math.max(0, opts.slaVendidas);
  const offer = Math.max(0, opts.offerHours);
  const target = opts.targetAvgHoursPerEmployee ?? 192;
  const avgRequired = n > 0 && sla > 0 ? Math.round((sla / n) * 10) / 10 : 0;
  const avgOffer = n > 0 && offer > 0 ? Math.round((offer / n) * 10) / 10 : 0;
  const capacityAdequate = n > 0 && sla > 0 && offer >= sla - tolerance && avgRequired <= target;

  let summary: string;
  if (n <= 0 || sla <= 0) {
    summary = 'Sin datos de plantilla o SLA';
  } else if (capacityAdequate) {
    summary = `${n} guardias · ${avgRequired}h/guardia requerido vs ~${avgOffer}h oferta (6+2) — capacidad OK`;
  } else if (offer < sla - tolerance) {
    summary = `${n} guardias · faltan ~${Math.round(sla - offer)}h oferta total`;
  } else {
    summary = `${n} guardias · ${avgRequired}h/guardia supera tope ${target}h`;
  }

  return { avgHoursRequiredPerGuard: avgRequired, avgHoursOfferPerGuard: avgOffer, capacityAdequate, summary };
}

export function computeHourHeadroom(opts: {
  slaVendidas: number;
  billableHours: number;
  offerHours?: number;
  tolerance?: number;
  employeeCount?: number;
  targetAvgHoursPerEmployee?: number;
}): HourHeadroom {
  const tolerance = opts.tolerance ?? 8;
  const sla = opts.slaVendidas;
  const billable = opts.billableHours;
  const offer = opts.offerHours ?? sla;
  const gapToSla = sla > 0 ? sla - billable : 0;
  const headroomHours = Math.max(0, offer - billable);
  const canUseContingency4x2 = headroomHours >= HOURS_PER_CYCLE_BLOCK - tolerance
    || gapToSla >= HOURS_PER_CYCLE_BLOCK - tolerance;

  const capacity = opts.employeeCount && opts.employeeCount > 0
    ? assessCapacityVsSla({
      employeeCount: opts.employeeCount,
      slaVendidas: sla,
      offerHours: offer,
      targetAvgHoursPerEmployee: opts.targetAvgHoursPerEmployee,
      tolerance,
    })
    : null;

  const assignmentGapNotHeadcount = !!capacity?.capacityAdequate && gapToSla > tolerance;

  let summary: string;
  if (sla <= 0) {
    summary = `${billable}h facturables`;
  } else if (assignmentGapNotHeadcount) {
    summary = `${capacity!.summary} · asignación ${billable}h (faltan ${gapToSla}h) — redistribuir, no sumar gente`;
  } else if (gapToSla > tolerance) {
    summary = canUseContingency4x2
      ? `Faltan ${gapToSla}h SLA · headroom ${Math.round(headroomHours)}h → puede 4+2`
      : `Faltan ${gapToSla}h SLA · sin headroom para 4+2`;
  } else {
    summary = capacity?.capacityAdequate
      ? `${billable}h / ${sla}h SLA OK · ${capacity.summary}`
      : `${billable}h / ${sla}h SLA OK`;
  }

  return {
    slaVendidas: sla,
    billableHours: billable,
    offerHours: offer,
    gapToSla,
    headroomHours,
    canUseContingency4x2,
    summary,
    employeeCount: opts.employeeCount,
    avgHoursRequiredPerGuard: capacity?.avgHoursRequiredPerGuard,
    avgHoursOfferPerGuard: capacity?.avgHoursOfferPerGuard,
    assignmentGapNotHeadcount,
  };
}

/** ¿Puede este empleado tomar el turno sin romper 6+2? */
export function candidateLegalFor6x2(opts: {
  assignments: VplanAssignment[];
  dateStrList: string[];
  empId: string;
  dateStr: string;
  shiftCode: string;
  cycle: string;
  previousMonthAssignments?: VplanExistingAssignment[];
  rules?: PlanningRulesConfig;
}): boolean {
  const r = wouldExceedCctWorkStreak({
    assignments: opts.assignments,
    dateStrs: opts.dateStrList,
    empId: opts.empId,
    dateStr: opts.dateStr,
    shiftCode: opts.shiftCode,
    cycle: opts.cycle,
    previousMonthAssignments: opts.previousMonthAssignments,
    rules: opts.rules,
  });
  return r.ok;
}

/**
 * Sugiere el escalón de cobertura para un hueco sin candidato 6+2 legal.
 */
export function recommendCoverageLadderStep(opts: {
  hourHeadroom: HourHeadroom;
  hasRetAvailable?: boolean;
  hasUnassignedPool?: boolean;
  onlyFtLeft?: boolean;
}): CoverageLadderKey {
  if (opts.onlyFtLeft) return 'FT_FRANCO_TRABAJADO';
  if (opts.hourHeadroom.canUseContingency4x2) return 'REFUERZO_4X2_OBJETIVO';
  if (opts.hasUnassignedPool) return 'SIN_TURNO_OBJETIVO';
  if (opts.hasRetAvailable) return 'RET_OBJETIVO';
  return 'FT_FRANCO_TRABAJADO';
}

export function ladderMessage(
  step: CoverageLadderKey,
  dateStr: string,
  positionName: string,
  shiftCode: string,
): string {
  const row = COVERAGE_LADDER.find((r) => r.key === step);
  return `${row?.label ?? step}: ${shiftCode} en ${positionName} (${dateStr})`;
}

export function maxWorkDaysForPlanningCycle(
  cycle: string,
  rules?: PlanningRulesConfig,
): number {
  return workDaysForCycle(cycle, rules ?? DEFAULT_PLANNING_RULES);
}

export function buildFeasibilityHourOffer(
  demand?: VplanDemandModel,
  supply?: VplanSupplyModel,
  feasibility?: VplanFeasibilityReport,
): number {
  if (feasibility?.offerHours && feasibility.offerHours > 0) {
    return feasibility.offerHours;
  }
  if (supply?.employees?.length) {
    return supply.employees.reduce((s, e) => s + (e.cctHoursRemaining ?? 0), 0);
  }
  return demand?.slaVendidas ?? 0;
}
