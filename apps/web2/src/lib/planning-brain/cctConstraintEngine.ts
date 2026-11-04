import type { EmployeeScheduleState, EmployeePhase } from './employeeScheduleState';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type ConstraintRule =
  | 'absence_conflict'      // tiene licencia ese día → HARD
  | 'duplicate_day'         // ya tiene turno ese día (otro objetivo) → HARD
  | 'rest_minimum'          // < 8h de descanso → HARD
  | 'rest_soft'             // 8–12h de descanso → SOFT (requiere PIN)
  | 'streak_max'            // racha > 6×8h o > 4×12h → HARD
  | 'hours_t1_overflow'     // cola + T1 + propuesta > 200h → HARD
  | 'hours_t2_overflow'     // T2 + propuesta > 200h → HARD
  | 'band_transition'       // N→M sin descanso suficiente → HARD
  | 'franco_no_streak'      // F sin haber completado 48h de racha → HARD
  | 'franco_third_consec';  // 3er F consecutivo → debe ser RET → HARD

export interface ConstraintViolation {
  rule: ConstraintRule;
  severity: 'hard' | 'soft';
  message: string;
  actual?: number;
  limit?: number;
}

export interface ConstraintVerdict {
  ok: boolean;
  severity: 'ok' | 'soft' | 'hard';
  violations: ConstraintViolation[];
}

export interface ShiftProposal {
  empId: string;
  dateStr: string;        // YYYY-MM-DD
  shiftCode: string;      // M / T / N / D12 / N12 / F / RET / FT / ...
  hours: number;          // horas facturables (0 para F / RET)
  startTimeISO: string;   // "2026-11-04T07:00:00-03:00"
  endTimeISO: string;     // "2026-11-04T15:00:00-03:00"
  objectiveId: string;
  positionName: string;
  phase?: EmployeePhase;
}

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const CCT_MAX_HOURS = 200;
const CCT_CUTOFF_DAY = 25;
const MIN_REST_HARD_HOURS = 8;
const MIN_REST_SOFT_HOURS = 12;
const MAX_STREAK_8H = 6;
const MAX_STREAK_12H = 4;
const AVG_HOURS_12H_THRESHOLD = 10;

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'FT', 'EN', 'RO', 'MA', 'ME']);
const REST_CODES = new Set(['F', 'FF', 'FP']);
const NIGHT_BANDS = new Set(['N', 'N12']);
const MORNING_BANDS = new Set(['M', 'D12']);

function isWorkShift(code: string): boolean {
  return WORK_CODES.has(code.toUpperCase());
}
function isFranco(code: string): boolean {
  return REST_CODES.has(code.toUpperCase());
}

/** Calcula la diferencia en horas entre dos ISO timestamps. */
function hoursBetween(isoA: string, isoB: string): number {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / 3_600_000;
}

// ─── FUNCIONES ────────────────────────────────────────────────────────────────

/**
 * Valida si la racha actual califica para un franco (≥48h o ≥6 días de 8h, ≥4 días de 12h).
 * CCT 422/05: mínimo 48h facturables en racha antes del primer franco.
 */
export function streakQualifiesForFranco(streakWorkDays: number, streakHours: number): boolean {
  if (streakWorkDays <= 0) return false;
  if (streakHours < 48) return false;
  const avg = streakHours / streakWorkDays;
  if (avg >= AVG_HOURS_12H_THRESHOLD) return streakWorkDays >= MAX_STREAK_12H;
  return streakWorkDays >= MAX_STREAK_8H;
}

/**
 * Valida si una propuesta de turno respeta las reglas del CCT 422/05.
 * Función pura: no tiene side effects, no importa nada de COSP.
 *
 * @param state     Estado actual del empleado (todos los objetivos)
 * @param proposal  Turno propuesto
 * @param absences  Mapa dateStr → código de ausencia del empleado
 * @param cutoffDay Día de corte T1/T2 (default 25)
 * @param maxHours  Tope de horas CCT (default 200)
 */
export function canAssign(
  state: EmployeeScheduleState,
  proposal: ShiftProposal,
  absences: Map<string, string>,
  cutoffDay = CCT_CUTOFF_DAY,
  maxHours = CCT_MAX_HOURS,
): ConstraintVerdict {
  const violations: ConstraintViolation[] = [];
  const code = proposal.shiftCode.toUpperCase();
  const isWork = isWorkShift(code);
  const isFrancoCode = isFranco(code);

  // ── REGLA 1: Licencia o turno duplicado ─────────────────────────────────
  if (absences.has(proposal.dateStr)) {
    return {
      ok: false,
      severity: 'hard',
      violations: [{
        rule: 'absence_conflict',
        severity: 'hard',
        message: `El empleado tiene ausencia (${absences.get(proposal.dateStr)}) el ${proposal.dateStr}`,
      }],
    };
  }

  if (state.assignmentsByDate.has(proposal.dateStr)) {
    const existing = state.assignmentsByDate.get(proposal.dateStr)!;
    return {
      ok: false,
      severity: 'hard',
      violations: [{
        rule: 'duplicate_day',
        severity: 'hard',
        message: `El empleado ya tiene turno ${existing.shiftCode} en objetivo ${existing.objectiveId} el ${proposal.dateStr}`,
      }],
    };
  }

  // ── REGLA 2: Descanso mínimo ─────────────────────────────────────────────
  if (isWork) {
    const lastEnd = state.lastShiftEndISOCurrent ?? state.lastShiftEndISO;
    if (lastEnd) {
      const gap = hoursBetween(lastEnd, proposal.startTimeISO);
      if (gap < MIN_REST_HARD_HOURS) {
        violations.push({
          rule: 'rest_minimum',
          severity: 'hard',
          message: `Descanso insuficiente: ${gap.toFixed(1)}h (mínimo ${MIN_REST_HARD_HOURS}h)`,
          actual: gap,
          limit: MIN_REST_HARD_HOURS,
        });
      } else if (gap < MIN_REST_SOFT_HOURS) {
        violations.push({
          rule: 'rest_soft',
          severity: 'soft',
          message: `Descanso corto: ${gap.toFixed(1)}h (recomendado ≥${MIN_REST_SOFT_HOURS}h, requiere PIN)`,
          actual: gap,
          limit: MIN_REST_SOFT_HOURS,
        });
      }
    }
  }

  // ── REGLA 3: Racha máxima ────────────────────────────────────────────────
  if (isWork && proposal.hours > 0) {
    const newStreakDays = state.streakWorkDays + 1;
    const newStreakHours = state.streakHours + proposal.hours;
    const avgHours = newStreakHours / newStreakDays;
    const maxStreak = avgHours >= AVG_HOURS_12H_THRESHOLD ? MAX_STREAK_12H : MAX_STREAK_8H;
    if (newStreakDays > maxStreak) {
      violations.push({
        rule: 'streak_max',
        severity: 'hard',
        message: `Racha máxima superada: ${newStreakDays} días (máximo ${maxStreak})`,
        actual: newStreakDays,
        limit: maxStreak,
      });
    }
  }

  // ── REGLA 4: Horas CCT ───────────────────────────────────────────────────
  if (isWork && proposal.hours > 0 && !state.authorizedOver200) {
    const dayNum = parseInt(proposal.dateStr.split('-')[2], 10);
    if (dayNum <= cutoffDay) {
      const totalT1 = state.hoursCarriedOverT1 + state.hoursT1 + proposal.hours;
      if (totalT1 > maxHours) {
        violations.push({
          rule: 'hours_t1_overflow',
          severity: 'hard',
          message: `Horas T1 superan ${maxHours}h: ${totalT1.toFixed(1)}h`,
          actual: totalT1,
          limit: maxHours,
        });
      }
    } else {
      const totalT2 = state.hoursT2 + proposal.hours;
      if (totalT2 > maxHours) {
        violations.push({
          rule: 'hours_t2_overflow',
          severity: 'hard',
          message: `Horas T2 superan ${maxHours}h: ${totalT2.toFixed(1)}h`,
          actual: totalT2,
          limit: maxHours,
        });
      }
    }
  }

  // ── REGLA 5: Transición de banda ─────────────────────────────────────────
  if (isWork) {
    const prevBand = (state.currentBand ?? state.lastWorkBand ?? '').toUpperCase();
    if (NIGHT_BANDS.has(prevBand) && MORNING_BANDS.has(code)) {
      const lastEnd = state.lastShiftEndISOCurrent ?? state.lastShiftEndISO;
      if (lastEnd) {
        const gap = hoursBetween(lastEnd, proposal.startTimeISO);
        if (gap < MIN_REST_SOFT_HOURS) {
          violations.push({
            rule: 'band_transition',
            severity: 'hard',
            message: `Transición ${prevBand}→${code} sin descanso suficiente: ${gap.toFixed(1)}h`,
            actual: gap,
            limit: MIN_REST_SOFT_HOURS,
          });
        }
      }
    }
  }

  // ── REGLAS DE FRANCO ─────────────────────────────────────────────────────
  if (isFrancoCode) {
    if (!streakQualifiesForFranco(state.streakWorkDays, state.streakHours)) {
      violations.push({
        rule: 'franco_no_streak',
        severity: 'hard',
        message: `Franco sin racha suficiente: ${state.streakWorkDays} días / ${state.streakHours}h (necesita ≥48h y ≥6 turnos de 8h o ≥4 de 12h)`,
        actual: state.streakHours,
        limit: 48,
      });
    }
    if (state.consecutiveRestDays >= 2) {
      violations.push({
        rule: 'franco_third_consec',
        severity: 'hard',
        message: `Tercer franco consecutivo: usar RET en su lugar`,
        actual: state.consecutiveRestDays + 1,
        limit: 2,
      });
    }
  }

  // ── RESULTADO ────────────────────────────────────────────────────────────
  const hasHard = violations.some(v => v.severity === 'hard');
  const hasSoft = violations.some(v => v.severity === 'soft');

  if (hasHard) return { ok: false, severity: 'hard', violations };
  if (hasSoft) return { ok: true, severity: 'soft', violations };
  return { ok: true, severity: 'ok', violations: [] };
}
