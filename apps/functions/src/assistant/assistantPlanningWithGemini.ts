/**
 * Pipeline Vigi: motor CCT (runAutoSchedule) + ajuste fino Gemini (mismo prompt que el wizard).
 * La IA no inventa el mes desde cero; corrige celdas sobre la base determinística.
 */

import type { GeminiCorreccion, GeminiRespuesta, PlannerContext } from './planningGeminiServer';
import { runPlanningGeminiOptimize } from './planningGeminiServer';
import type { RunAutoScheduleOutput } from '../scheduling/runAutoSchedule';

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);
const SHIFT_HRS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9, RO: 10 };
const SHIFT_START: Record<string, string> = {
  M: '06:00',
  T: '14:00',
  N: '22:00',
  D12: '07:00',
  N12: '19:00',
  EN: '08:00',
  RO: '20:00',
};

type Assignment = RunAutoScheduleOutput['assignments'][number];

export type PlannerSeed = {
  positions: Array<{
    positionName: string;
    qty?: number;
    shifts?: Array<{ code: string; name?: string; hours?: number; startTime?: string; endTime?: string; days?: string[] }>;
    activeDays?: string[];
    coverageType?: string;
    excludedDates?: string[];
  }>;
  employees: Array<{ id: string; nombre?: string }>;
  days: string[];
  slaVendidas: number;
  absences: Record<string, string[]>;
};

function maxBillableHoursPerPositionDay(pos: PlannerSeed['positions'][number]): number {
  const qty = Math.max(1, Number(pos?.qty) || 1);
  const cov = String(pos?.coverageType || 'custom').toLowerCase();
  if (cov === '24hs' || cov === '24' || cov === '24h') return qty * 24;
  const shiftsArr = Array.isArray(pos?.shifts) ? pos.shifts : [];
  const sumHs = shiftsArr.reduce((acc, s) => acc + (Number(s.hours) || 8), 0);
  const banda = sumHs > 0 ? sumHs : 8;
  return qty * banda;
}

function billableHours(assignments: Assignment[], dateStr: string, positionName: string): number {
  return assignments.reduce((s, a) => {
    if (a.dateStr !== dateStr || a.positionName !== positionName) return s;
    const c = String(a.code || '').toUpperCase();
    if (NON_BILLABLE.has(c)) return s;
    return s + (Number(a.hours) || SHIFT_HRS[c] || 0);
  }, 0);
}

function dayLetter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][dow] || 'L';
}

function positionActiveOnDay(pos: PlannerSeed['positions'][number], letter: string): boolean {
  const days = Array.isArray(pos.activeDays) ? pos.activeDays.map((x) => String(x).toUpperCase()) : null;
  if (!days || days.length === 0 || days.length === 7) return true;
  const map: Record<string, string[]> = {
    L: ['L', 'LU', 'LUN', 'LUNES', '1'],
    M: ['M', 'MA', 'MAR', 'MARTES', '2'],
    X: ['X', 'MI', 'MIE', 'MIÉRCOLES', 'MIERCOLES', '3'],
    J: ['J', 'JU', 'JUE', 'JUEVES', '4'],
    V: ['V', 'VI', 'VIE', 'VIERNES', '5'],
    S: ['S', 'SA', 'SAB', 'SÁBADO', 'SABADO', '6'],
    D: ['D', 'DO', 'DOM', 'DOMINGO', '0'],
  };
  const aliases = map[letter] || [letter];
  return days.some((d) => aliases.includes(d) || d === letter);
}

function buildCoberturaPorDia(
  seed: PlannerSeed,
  assignments: Assignment[],
  positionGroups: Record<string, string[]>,
): PlannerContext['coberturaPorDia'] {
  const out: NonNullable<PlannerContext['coberturaPorDia']> = {};
  for (const dateStr of seed.days) {
    const letter = dayLetter(dateStr);
    out[dateStr] = {};
    for (const pos of seed.positions) {
      const posName = pos.positionName;
      const active = positionActiveOnDay(pos, letter);
      if (!active) {
        out[dateStr][posName] = { actual: 0, requerido: 0, deficit: 0, retDisponibles: 0 };
        continue;
      }
      const requerido = maxBillableHoursPerPositionDay(pos);
      const actual = billableHours(assignments, dateStr, posName);
      const group = positionGroups[posName] || [];
      const retDisponibles = assignments.filter(
        (a) => a.dateStr === dateStr && group.includes(a.empId) && String(a.code).toUpperCase() === 'RET',
      ).length;
      out[dateStr][posName] = {
        actual,
        requerido,
        deficit: Math.max(0, requerido - actual),
        retDisponibles,
      };
    }
  }
  return out;
}

function buildPlanificacionCompleta(
  assignments: Assignment[],
): PlannerContext['planificacionCompleta'] {
  const byEmp: Record<string, Array<{ fecha: string; codigo: string; puesto: string }>> = {};
  for (const a of assignments) {
    if (!byEmp[a.empId]) byEmp[a.empId] = [];
    byEmp[a.empId].push({
      fecha: a.dateStr,
      codigo: String(a.code || '').toUpperCase(),
      puesto: a.positionName || 'General',
    });
  }
  return byEmp;
}

function buildEmpleadosPayload(
  seed: PlannerSeed,
  assignments: Assignment[],
  stats: RunAutoScheduleOutput['stats'],
): PlannerContext['empleados'] {
  const groups = stats.positionGroups || {};
  const empPos: Record<string, string> = {};
  Object.entries(groups).forEach(([pos, ids]) => {
    (ids || []).forEach((id) => {
      empPos[id] = pos;
    });
  });
  const monthly = stats.employeeMonthlyHours || {};
  const values = Object.values(monthly).filter((h) => h > 0);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  return seed.employees.map((e) => {
    const puestoAsignado = empPos[e.id] || null;
    const horasMes = monthly[e.id] || 0;
    const groupIds = puestoAsignado ? groups[puestoAsignado] || [] : [];
    const ownerVirtual = !!puestoAsignado && groupIds.length === 1 && groupIds[0] === e.id;
    const posCfg = puestoAsignado ? seed.positions.find((p) => p.positionName === puestoAsignado) : null;
    return {
      id: e.id,
      nombre: e.nombre,
      puestoAsignado,
      defaultPos: puestoAsignado,
      ownerVirtual,
      horasMes,
      priorHoursCiclo: 0,
      diferenciaProm: Math.round((horasMes - avg) * 10) / 10,
      qtyPuesto: posCfg ? Number(posCfg.qty) || 1 : 1,
    };
  });
}

export function buildPlannerContextFromScheduleResult(params: {
  mesLabel: string;
  objetivoNombre: string;
  seed: PlannerSeed;
  result: RunAutoScheduleOutput;
}): PlannerContext {
  const absencesObj: Record<string, Record<string, string>> = {};
  Object.entries(params.seed.absences || {}).forEach(([empId, dates]) => {
    absencesObj[empId] = {};
    (dates || []).forEach((d) => {
      absencesObj[empId][d] = 'A';
    });
  });

  return {
    mes: params.mesLabel,
    objetivo: params.objetivoNombre,
    slaVendidas: params.seed.slaVendidas,
    puestos: params.seed.positions,
    empleados: buildEmpleadosPayload(params.seed, params.result.assignments, params.result.stats),
    dias: params.seed.days,
    diasBloqueados: [],
    planificacionCompleta: buildPlanificacionCompleta(params.result.assignments),
    ausencias: absencesObj,
    coberturaPorDia: buildCoberturaPorDia(
      params.seed,
      params.result.assignments,
      params.result.stats.positionGroups || {},
    ),
    autoCycles: ['6+2'],
  };
}

export function mergeGeminiCorrectionsIntoAssignments(
  assignments: Assignment[],
  correcciones: GeminiCorreccion[],
  positions: PlannerSeed['positions'],
): { assignments: Assignment[]; applied: number; skipped: number } {
  const next = [...assignments];
  const idx = new Map<string, number>();
  next.forEach((a, i) => idx.set(`${a.empId}_${a.dateStr}`, i));

  let applied = 0;
  let skipped = 0;

  for (const c of correcciones) {
    const empId = String(c.empId || '').trim();
    const fecha = String(c.fecha || '').trim();
    const code = String(c.codigoNuevo || '').toUpperCase().trim();
    if (!empId || !fecha || !code) {
      skipped += 1;
      continue;
    }
    const posName = String(c.puesto || '').trim() || 'General';
    const pos = positions.find((p) => p.positionName === posName);
    const shiftMeta = (pos?.shifts || []).find((s) => String(s.code || '').toUpperCase() === code);
    const hours = NON_BILLABLE.has(code)
      ? 0
      : Number(shiftMeta?.hours) || SHIFT_HRS[code] || 8;
    const startTime = String(shiftMeta?.startTime || SHIFT_START[code] || '07:00').slice(0, 5);
    const endTime = shiftMeta?.endTime ? String(shiftMeta.endTime).slice(0, 5) : undefined;
    const patch: Assignment = {
      empId,
      dateStr: fecha,
      positionName: posName,
      code,
      name: shiftMeta?.name || code,
      hours,
      startTime,
      ...(endTime ? { endTime } : {}),
      ...(code === 'F' || code === 'FF' || code === 'FP' || code === 'RET' ? { isFranco: code !== 'RET' ? true : false } : { isFranco: false }),
    };
    const key = `${empId}_${fecha}`;
    const i = idx.get(key);
    if (i !== undefined) next[i] = { ...next[i], ...patch };
    else {
      idx.set(key, next.length);
      next.push(patch);
    }
    applied += 1;
  }

  return { assignments: next, applied, skipped };
}

export type OptimizeScheduleResult = {
  assignments: Assignment[];
  gemini: GeminiRespuesta | null;
  applied: number;
  skipped: number;
  usedAi: boolean;
  aiError?: string;
};

/**
 * Ajuste fino IA. Si falta API key o Gemini falla, devuelve el cronograma del motor sin romper el flujo.
 */
export async function optimizeScheduleAssignmentsWithGemini(params: {
  mesLabel: string;
  objetivoNombre: string;
  seed: PlannerSeed;
  result: RunAutoScheduleOutput;
}): Promise<OptimizeScheduleResult> {
  const uncovered = Number(params.result.coverage?.uncoveredSlots ?? 0);
  const slaClosed = params.result.coverage?.slaHoursClosed === true;
  const forceOrNeeded = uncovered > 0 || !slaClosed || !params.result.ok;

  // Siempre pedimos IA en el flujo Vigi (el usuario pide calidad); si falla, caemos al motor.
  try {
    const context = buildPlannerContextFromScheduleResult(params);
    const gemini = await runPlanningGeminiOptimize(context);
    if (gemini.bloqueoEstructural) {
      return {
        assignments: params.result.assignments,
        gemini,
        applied: 0,
        skipped: 0,
        usedAi: true,
      };
    }
    if (!gemini.correcciones?.length) {
      return {
        assignments: params.result.assignments,
        gemini,
        applied: 0,
        skipped: 0,
        usedAi: true,
      };
    }
    const merged = mergeGeminiCorrectionsIntoAssignments(
      params.result.assignments,
      gemini.correcciones,
      params.seed.positions,
    );
    return {
      assignments: merged.assignments,
      gemini,
      applied: merged.applied,
      skipped: merged.skipped,
      usedAi: true,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[assistantPlanningWithGemini] fallback motor sin IA', {
      msg: msg.slice(0, 240),
      forceOrNeeded,
    });
    return {
      assignments: params.result.assignments,
      gemini: null,
      applied: 0,
      skipped: 0,
      usedAi: false,
      aiError: msg.slice(0, 240),
    };
  }
}
