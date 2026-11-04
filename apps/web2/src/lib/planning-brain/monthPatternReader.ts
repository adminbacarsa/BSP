import type { WorkBand, EmployeePhase } from './employeeScheduleState';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

/** Asignación mínima del mes anterior necesaria para leer el patrón. */
export interface MonthAssignment {
  dateStr: string;    // YYYY-MM-DD
  shiftCode: string;  // M / T / N / D12 / N12 / F / RET / V / L / E / ...
  hours: number;      // horas facturables (0 para F / RET)
}

/** Resultado de readMonthPattern: estado de continuación de un empleado. */
export interface EmployeeMonthPattern {
  empId: string;
  phase: EmployeePhase;

  /** Días de trabajo consecutivos al cierre del mes anterior (sin contar ausencias). */
  trailingWorkDays: number;

  /** Francos consecutivos al cierre del mes anterior. */
  trailingRestDays: number;

  /** Horas reales trabajadas en la racha al cierre (D12=12h, M=8h, etc.). */
  trailingWorkHours: number;

  /** Código del último turno de trabajo real (no licencia, no F). Null si no hubo trabajo. */
  lastWorkCode: string | null;

  /** YYYY-MM-DD del último turno de trabajo real. Null si no hubo trabajo. */
  lastWorkDateStr: string | null;

  /**
   * Banda del último turno real.
   * D12/N12 se mantienen como están (WorkBand válidos).
   * MA/ME → 'M'. EN/RO/otros → null (no son WorkBand estándar).
   */
  lastWorkBand: WorkBand | null;

  /** Rotación del empleado (viene del SLA, no se infiere del historial). */
  rotation: string[];

  /**
   * Horas del ciclo CCT 26→25 ya usadas en el mes anterior.
   * Son las horas trabajadas en el tramo día > cutoffDay (ej: oct 26→31).
   * Determinan cuánto margen queda en T1 del mes actual.
   */
  hoursCarriedOverT1: number;

  /**
   * Banda del tramo de trabajo inmediatamente ANTERIOR al trailing actual.
   * null si no hay tramo previo identificable.
   * Permite saber si el guardia "llegó" a su banda desde otra (reclamo débil)
   * o si su historial es consistente con la banda actual (reclamo fuerte).
   */
  prevWorkBand: WorkBand | null;
}

/** Config del SLA para un empleado. */
export interface SlaConfig {
  empId?: string;
  rotation: string[];
  phase?: EmployeePhase;
}

/** Opciones opcionales de readMonthPattern. */
export interface ReadMonthPatternOpts {
  /** RFZF activo al cierre del mes: si fromDate ≤ lastWorkDateStr, usa su banda. */
  activeRfzf?: { band: WorkBand; fromDate: string } | null;
  /** Horarios de fin de turno custom (sobreescribe los defaults para EN/RO/etc.). */
  customShiftEndDef?: Record<string, { hour: number; nextDay: boolean }>;
  /** Día de corte T1/T2 del ciclo CCT (default 25). */
  cctCutoffDay?: number;
}

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'FT', 'EN', 'RO', 'MA', 'ME']);
const REST_CODES = new Set(['F', 'FF', 'FP']);
const NEUTRAL_CODES = new Set(['RET', 'ESC', 'ART', 'V', 'L', 'E', 'A', 'PG', 'AA', 'RFZE', 'RFZF']);

/** Mapea un código de trabajo a WorkBand (null si no es WorkBand estándar). */
function toWorkBand(code: string): WorkBand | null {
  const c = code.toUpperCase();
  if (c === 'MA' || c === 'ME') return 'M';
  const VALID: WorkBand[] = ['M', 'T', 'N', 'D12', 'N12'];
  return (VALID as string[]).includes(c) ? (c as WorkBand) : null;
}

// ─── FUNCIÓN PRINCIPAL ───────────────────────────────────────────────────────

/**
 * Lee las asignaciones del mes anterior para UN empleado y extrae su estado
 * de continuación. El output alimenta directamente buildInitialState().
 *
 * Las asignaciones deben estar en orden cronológico (asc por dateStr).
 */
export function readMonthPattern(
  assignments: MonthAssignment[],
  slaConfig: SlaConfig,
  opts: ReadMonthPatternOpts = {},
): EmployeeMonthPattern {
  const cutoff = opts.cctCutoffDay ?? 25;

  const empId = slaConfig.empId ?? '';

  // ── 1. hoursCarriedOverT1: horas de trabajo en días > cutoff (tramo 26→fin) ──
  let hoursCarriedOverT1 = 0;
  for (const a of assignments) {
    const dayNum = parseInt(a.dateStr.split('-')[2], 10);
    if (dayNum > cutoff && WORK_CODES.has(a.shiftCode.toUpperCase()) && a.hours > 0) {
      hoursCarriedOverT1 += a.hours;
    }
  }

  // ── 2. Trailing: recorrer desde el último día hacia atrás ───────────────────
  let trailingRestDays = 0;
  let trailingWorkDays = 0;
  let trailingWorkHours = 0;
  let lastWorkCode: string | null = null;
  let lastWorkDateStr: string | null = null;

  type ScanPhase = 'scanning_rest' | 'scanning_work' | 'done';
  let scanPhase: ScanPhase = 'scanning_rest';
  let scanBreakIdx = -1;

  for (let i = assignments.length - 1; i >= 0; i--) {
    if (scanPhase === 'done') break;
    const a = assignments[i];
    const code = a.shiftCode.toUpperCase();

    if (scanPhase === 'scanning_rest') {
      if (REST_CODES.has(code)) {
        trailingRestDays++;
      } else if (WORK_CODES.has(code)) {
        scanPhase = 'scanning_work';
        trailingWorkDays = 1;
        trailingWorkHours = a.hours;
        lastWorkCode = a.shiftCode;
        lastWorkDateStr = a.dateStr;
      }
      // NEUTRAL_CODES al final: no cuenta ni interrumpe
    } else if (scanPhase === 'scanning_work') {
      if (WORK_CODES.has(code)) {
        trailingWorkDays++;
        trailingWorkHours += a.hours;
        lastWorkCode = a.shiftCode;
        lastWorkDateStr = a.dateStr;
      } else if (REST_CODES.has(code)) {
        scanBreakIdx = i;
        scanPhase = 'done';
      }
      // NEUTRAL_CODES en medio de la racha: no interrumpe, no suma
    }
  }

  // ── 2b. prevWorkBand: banda del tramo previo al trailing ───────────────────
  let prevWorkBand: WorkBand | null = null;
  if (trailingWorkDays > 0 && scanBreakIdx >= 0) {
    let seenFranco = false;
    for (let i = scanBreakIdx; i >= 0; i--) {
      const code = assignments[i].shiftCode.toUpperCase();
      if (REST_CODES.has(code)) {
        seenFranco = true;
      } else if (NEUTRAL_CODES.has(code)) {
        // transparente
      } else if (WORK_CODES.has(code)) {
        if (seenFranco) {
          const wb = toWorkBand(code);
          if (wb !== null) { prevWorkBand = wb; break; }
        }
      }
    }
  }

  // ── 3. lastWorkBand ─────────────────────────────────────────────────────────
  let lastWorkBand: WorkBand | null = null;
  if (lastWorkCode !== null && lastWorkDateStr !== null) {
    if (opts.activeRfzf && opts.activeRfzf.fromDate <= lastWorkDateStr) {
      lastWorkBand = opts.activeRfzf.band;
    } else {
      lastWorkBand = toWorkBand(lastWorkCode);
    }
  }

  return {
    empId,
    phase: slaConfig.phase ?? 'fijo',
    trailingWorkDays,
    trailingRestDays,
    trailingWorkHours,
    lastWorkCode,
    lastWorkDateStr,
    lastWorkBand,
    rotation: slaConfig.rotation,
    hoursCarriedOverT1,
    prevWorkBand,
  };
}
