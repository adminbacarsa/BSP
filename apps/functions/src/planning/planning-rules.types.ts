/** Reglas de planificación / CCT configurables por empresa (Firestore: planning_rules/{empresaId}). */

export type PlanningRulesStatus = 'ACTIVE' | 'INACTIVE';

export type PlanningCycleKey = '6+2' | '4+2' | '5+1' | '6+1';

export interface PlanningCycleRule {
  /** Días consecutivos de trabajo antes del bloque de descanso. */
  workDays: number;
  /** Días consecutivos de franco al cerrar bloque de trabajo. */
  restDays: number;
  /** Horas por turno de trabajo en el ciclo. */
  shiftHours: 8 | 12;
  /** Si el ciclo puede elegirse en VPLAN / planificación. */
  enabled: boolean;
}

export interface PlanningRulesConfig {
  status: PlanningRulesStatus;
  updatedAt?: string;
  updatedBy?: string;

  /** Tope CCT horas facturables por ciclo (ej. 200). */
  cctMaxBillableHours: number;
  /** Horas objetivo promedio por empleado en el ciclo (viabilidad). */
  targetAvgHoursPerEmployee: number;
  /** Descanso horario mínimo entre bandas consecutivas sin F (horas). */
  minRestHoursBetweenBands: number;
  /**
   * Tope horas de trabajo consecutivas (referencia operativa / alerta).
   * Ej. 56h ≈ 7×8h. No reemplaza la racha por días del ciclo CCT.
   */
  maxConsecutiveWorkHours: number;

  /** Ciclo por defecto si la corrida no indica otro. */
  defaultCycle: PlanningCycleKey;
  /** Definición por tipo de ciclo CCT. */
  cycles: Record<PlanningCycleKey, PlanningCycleRule>;

  /** Solver VPLAN — iteraciones máximas de cierre SLA. */
  solverMaxIterations: number;
  /** No convertir turno→F si eso incrementa slots SLA descubiertos. */
  protectCoverageOnEnforce: boolean;
  /** Tolerancia ± horas vs SLA vendidas (verificación). */
  slaHoursTolerance: number;
  /** Ratio mínimo de cobertura para verificación OK (0–1). */
  coverageRatioMin: number;
}
