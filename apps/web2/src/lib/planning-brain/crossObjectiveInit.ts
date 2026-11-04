import type { WorkBand, EmployeeScheduleState } from './employeeScheduleState';
import { buildInitialState } from './employeeScheduleState';
import { readMonthPattern } from './monthPatternReader';
import type { MonthAssignment, EmployeeMonthPattern, SlaConfig, ReadMonthPatternOpts } from './monthPatternReader';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

/**
 * Fetcher inyectado: busca las asignaciones del mes anterior para un empleado
 * cruzando TODOS los objetivos donde pudo haber trabajado.
 */
export type PrevMonthFetcher = (
  empId: string,
  monthStr: string,
) => Promise<MonthAssignment[]>;

export interface CrossObjectiveInitInput {
  empIds: string[];
  prevMonthStr: string;                                      // 'YYYY-MM'
  slaConfigs: Map<string, SlaConfig>;                        // empId → config en objetivo destino
  fetchPrevMonth: PrevMonthFetcher;
  rfzfByEmp?: Map<string, { band: WorkBand; fromDate: string }>;
  cctCutoffDay?: number;
}

export interface CrossObjectiveInitWarning {
  empId: string;
  kind: 'no_prev_data';
  detail: string;
}

export interface CrossObjectiveInitResult {
  states: Map<string, EmployeeScheduleState>;
  patterns: Map<string, EmployeeMonthPattern>;
  warnings: CrossObjectiveInitWarning[];
}

// ─── FUNCIÓN PRINCIPAL ───────────────────────────────────────────────────────

/**
 * Inicializa el estado CCT de un grupo de empleados leyendo su historial
 * del mes anterior en TODOS los objetivos donde pudieron haber trabajado.
 *
 * Caso de uso principal: guardia que en octubre estaba en Tadicor y en
 * noviembre pasa a Obrador. fetchPrevMonth devuelve sus turnos reales de
 * Tadicor → readMonthPattern calcula el estado correcto para Obrador.
 */
export async function crossObjectiveInit(
  input: CrossObjectiveInitInput,
): Promise<CrossObjectiveInitResult> {
  const {
    empIds,
    prevMonthStr,
    slaConfigs,
    fetchPrevMonth,
    rfzfByEmp,
    cctCutoffDay,
  } = input;

  const states = new Map<string, EmployeeScheduleState>();
  const patterns = new Map<string, EmployeeMonthPattern>();
  const warnings: CrossObjectiveInitWarning[] = [];

  // Última fecha del mes anterior (para inferLastShiftEndISO)
  const [prevY, prevM] = prevMonthStr.split('-').map(Number);
  const lastDayOfPrevMonth = new Date(prevY, prevM, 0).getDate();
  const lastDateStr = `${prevMonthStr}-${String(lastDayOfPrevMonth).padStart(2, '0')}`;

  await Promise.all(
    empIds.map(async (empId) => {
      const slaConfig = slaConfigs.get(empId);
      if (!slaConfig) return;

      const assignments = await fetchPrevMonth(empId, prevMonthStr);

      if (assignments.length === 0) {
        warnings.push({
          empId,
          kind: 'no_prev_data',
          detail: `Sin turnos en ${prevMonthStr} para ${empId}`,
        });
      }

      const opts: ReadMonthPatternOpts = {
        activeRfzf: rfzfByEmp?.get(empId) ?? null,
        cctCutoffDay,
      };

      // SlaConfig con empId para que readMonthPattern lo propague
      const slaWithId: SlaConfig = { ...slaConfig, empId };
      const pattern = readMonthPattern(assignments, slaWithId, opts);
      patterns.set(empId, pattern);

      const state = buildInitialState({
        empId,
        hoursCarriedOverT1: pattern.hoursCarriedOverT1,
        trailingWorkDays: pattern.trailingWorkDays,
        trailingRestDays: pattern.trailingRestDays,
        trailingWorkHours: pattern.trailingWorkHours,
        lastCode: pattern.lastWorkCode,
        lastDateStr: pattern.lastWorkDateStr ?? lastDateStr,
        lastWorkBand: pattern.lastWorkBand,
      });
      states.set(empId, state);
    }),
  );

  return { states, patterns, warnings };
}
