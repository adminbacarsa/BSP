// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type EmployeePhase = 'fijo' | 'volante' | 'ret' | 'eventual';

export type WorkBand = 'M' | 'T' | 'N' | 'D12' | 'N12';

export interface AssignmentRecord {
  objectiveId: string;
  shiftCode: string;
  hours: number;
  startISO: string;
  endISO: string;
}

export interface EmployeeScheduleState {
  empId: string;

  // ── Input al inicio del mes (viene de Firestore / mes anterior) ──────────
  hoursCarriedOverT1: number;
  // Cola CCT del mes anterior (horas del ciclo 26→25 que ya se usaron).
  // Determina cuánto margen queda en T1 del mes actual.

  trailingWorkDays: number;
  // Días de trabajo consecutivos al cierre del mes anterior.
  // Si llega con 4, solo puede trabajar 2 más antes del próximo franco.

  trailingRestDays: number;
  // Francos consecutivos al cierre del mes anterior.

  lastShiftEndISO: string | null;
  // ISO del fin del último turno del mes anterior.
  // Permite calcular exactamente el descanso antes del primer turno del mes.

  lastWorkBand: WorkBand | null;
  // Última banda real trabajada (para transición M→T→N correcta).

  // ── Acumulado durante la generación ─────────────────────────────────────
  hoursT1: number;             // horas asignadas en T1 del mes actual (días 1→25)
  hoursT2: number;             // horas asignadas en T2 del mes actual (días 26→fin)

  streakWorkDays: number;      // racha actual de días trabajados (todos los objetivos)
  streakHours: number;         // horas en la racha (para validar las 48h pre-franco)
  consecutiveRestDays: number; // francos consecutivos actuales (para limitar a 2 F)

  currentBand: WorkBand | null;
  // Banda del último turno asignado en el mes actual.

  lastShiftEndISOCurrent: string | null;
  // ISO del fin del último turno asignado en el mes actual.
  // Reemplaza a lastShiftEndISO una vez que se asigna el primer turno.

  // ── Fase y permisos ──────────────────────────────────────────────────────
  phase: EmployeePhase;
  authorizedOver200: boolean;

  // ── Cross-objetivo ───────────────────────────────────────────────────────
  // Hoy: solo asignaciones del objetivo actual.
  // Después: se carga con asignaciones de todos los objetivos antes de cada motor.
  assignmentsByDate: Map<string, AssignmentRecord>;
}

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

/** Horarios de fin de cada turno (hora local Argentina, UTC-3 fijo). */
const SHIFT_END_DEF: Record<string, { hour: number; nextDay: boolean }> = {
  M:   { hour: 15, nextDay: false },   // 07:00–15:00
  T:   { hour: 23, nextDay: false },   // 15:00–23:00
  N:   { hour:  7, nextDay: true  },   // 23:00–07:00 día siguiente
  D12: { hour: 19, nextDay: false },   // 07:00–19:00
  N12: { hour:  7, nextDay: true  },   // 19:00–07:00 día siguiente
  EN:  { hour: 17, nextDay: false },   // Encubrimiento: 08:00–17:00
  RO:  { hour: 18, nextDay: false },   // Rondín: 08:00–18:00
};

// ─── FUNCIONES ────────────────────────────────────────────────────────────────

/**
 * Calcula el ISO timestamp del fin del último turno del mes anterior.
 * Argentina no tiene horario de verano → UTC-3 constante.
 */
export function inferLastShiftEndISO(
  lastCode: string | null,
  lastDateStr: string | null, // YYYY-MM-DD del último día del mes anterior
): string | null {
  if (!lastCode || !lastDateStr) return null;
  const def = SHIFT_END_DEF[lastCode.toUpperCase()];
  if (!def) return null;

  const [y, m, d] = lastDateStr.split('-').map(Number);
  const endDate = new Date(y, m - 1, d + (def.nextDay ? 1 : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}` +
    `T${pad(def.hour)}:00:00-03:00`
  );
}

/** Input para construir el estado inicial de un empleado. */
export interface BuildInitialStateInput {
  empId: string;
  /** Horas del ciclo CCT 26→25 ya usadas en el mes anterior. */
  hoursCarriedOverT1: number;
  /** Días de trabajo consecutivos al cierre del mes anterior. */
  trailingWorkDays: number;
  /** Francos consecutivos al cierre del mes anterior. */
  trailingRestDays: number;
  /** Código del último turno del mes anterior ('M'|'T'|'N'|'D12'|'N12'|null). */
  lastCode: string | null;
  /** YYYY-MM-DD del último día del mes anterior. */
  lastDateStr: string | null;
  /** Última banda real trabajada. */
  lastWorkBand: WorkBand | null;
  /** Horas trabajadas en la racha al cierre del mes anterior. Si no se conoce, se estima trailingWorkDays × 8. */
  trailingWorkHours?: number;
  phase?: EmployeePhase;
  authorizedOver200?: boolean;
}

/** Construye el estado inicial de un empleado antes de generar el mes. */
export function buildInitialState(input: BuildInitialStateInput): EmployeeScheduleState {
  return {
    empId: input.empId,
    hoursCarriedOverT1: input.hoursCarriedOverT1,
    trailingWorkDays: input.trailingWorkDays,
    trailingRestDays: input.trailingRestDays,
    lastShiftEndISO: inferLastShiftEndISO(input.lastCode, input.lastDateStr),
    lastWorkBand: input.lastWorkBand,
    hoursT1: 0,
    hoursT2: 0,
    streakWorkDays: input.trailingWorkDays,
    streakHours: input.trailingWorkHours ?? input.trailingWorkDays * 8,
    consecutiveRestDays: input.trailingRestDays,
    currentBand: null,
    lastShiftEndISOCurrent: null,
    phase: input.phase ?? 'fijo',
    authorizedOver200: input.authorizedOver200 ?? false,
    assignmentsByDate: new Map(),
  };
}

/** Una asignación completada (propuesta + resultado). */
export interface CompletedAssignment {
  dateStr: string;        // YYYY-MM-DD
  shiftCode: string;
  hours: number;
  startISO: string;
  endISO: string;
  objectiveId: string;
  positionName: string;
}

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'FT', 'EN', 'RO', 'MA', 'ME']);
const REST_CODES = new Set(['F', 'FF', 'FP']);
const WORK_BANDS_SET = new Set(['M', 'T', 'N', 'D12', 'N12']);

function isWorkShift(code: string): boolean {
  return WORK_CODES.has(code.toUpperCase());
}
function isRestCode(code: string): boolean {
  return REST_CODES.has(code.toUpperCase());
}

/**
 * Aplica una asignación al estado del empleado. Inmutable: devuelve nuevo estado.
 */
export function applyAssignment(
  state: EmployeeScheduleState,
  assignment: CompletedAssignment,
  cctCutoffDay = 25,
): EmployeeScheduleState {
  const code = assignment.shiftCode.toUpperCase();
  const isWork = isWorkShift(code);
  const isRest = isRestCode(code);
  const isRet = code === 'RET';
  const dayNum = parseInt(assignment.dateStr.split('-')[2], 10);

  // Horas CCT
  let hoursT1 = state.hoursT1;
  let hoursT2 = state.hoursT2;
  if (isWork && assignment.hours > 0) {
    if (dayNum <= cctCutoffDay) hoursT1 += assignment.hours;
    else hoursT2 += assignment.hours;
  }

  // Racha de trabajo y descanso
  let streakWorkDays = state.streakWorkDays;
  let streakHours = state.streakHours;
  let consecutiveRestDays = state.consecutiveRestDays;

  if (isWork) {
    streakWorkDays += 1;
    streakHours += assignment.hours;
    consecutiveRestDays = 0;
  } else if (isRest) {
    streakWorkDays = 0;
    streakHours = 0;
    consecutiveRestDays += 1;
  } else if (isRet) {
    // RET cuenta dentro del ciclo como unidad (puede volverse turno real)
    streakWorkDays += 1;
    consecutiveRestDays = 0;
  }

  // Banda actual
  const codeUpper = code as WorkBand;
  const currentBand = WORK_BANDS_SET.has(code) ? codeUpper : state.currentBand;

  // Mapa de asignaciones
  const assignmentsByDate = new Map(state.assignmentsByDate);
  assignmentsByDate.set(assignment.dateStr, {
    objectiveId: assignment.objectiveId,
    shiftCode: assignment.shiftCode,
    hours: assignment.hours,
    startISO: assignment.startISO,
    endISO: assignment.endISO,
  });

  return {
    ...state,
    hoursT1,
    hoursT2,
    streakWorkDays,
    streakHours,
    consecutiveRestDays,
    currentBand,
    lastShiftEndISOCurrent: isWork || isRet ? assignment.endISO : state.lastShiftEndISOCurrent,
    assignmentsByDate,
  };
}
