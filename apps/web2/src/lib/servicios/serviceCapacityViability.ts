/**
 * Viabilidad de capacidad por servicio: paquete SLA del mes vs oferta neta
 * de guardias preferidos al objetivo (techo 200 CCT, francos de esquema,
 * vacaciones por antigüedad prorrateadas, ausentismo mes anterior sin V).
 */

import type { ServicePosition, ServiceSLA } from '@/services/slaService';
import { SUVICO_POLICY } from '@/lib/planificacion/suvicoPolicy';
import { CCT_HS_TECHO_MENSUAL } from '@/lib/analisis/analisisBolsa';
import { buildAusenciasStats } from '@/lib/analisis/analisisQueries';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import {
  WorkScheme,
  billableHoursOneHeadInMonth,
  daysInCalendarMonth,
} from '@/lib/servicios/serviceMarginOptimizer';
import { calculateSlaHoursForMonth } from '@/lib/servicios/slaHoursCalculator';

export { CCT_HS_TECHO_MENSUAL };

const r1 = (n: number) => Math.round(n * 10) / 10;

export type ShiftBandCode = 'M' | 'T' | 'N' | 'D12' | 'N12' | 'SIN_TIPIFICAR';

export type CapacityEmployeeInput = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  startDate?: unknown;
  fechaIngreso?: unknown;
  status?: string;
  preferredObjectiveId?: string;
  planificacionDotacion?: Record<string, { positionName?: string; shiftCode?: string }>;
};

export type GuardCapacityRow = {
  employeeId: string;
  name: string;
  yearsSeniority: number;
  vacationDaysYear: number;
  vacationDaysMonthProrated: number;
  vacationHsMonth: number;
  shiftCode: ShiftBandCode;
  scheme: WorkScheme;
  jornadaHs: number;
  schemeHsMonth: number;
  brutoCapHs: number;
  netHs: number;
  tipificado: boolean;
};

export type ShiftMixRow = {
  code: ShiftBandCode;
  guards: number;
  slaHint: string;
};

export type ServiceCapacityViability = {
  year: number;
  month: number;
  daysInMonth: number;
  techoHs: number;
  slaHsMonth: number;
  plantilla: number;
  capacityBrutaHs: number;
  capacityAfterVacHs: number;
  capacityNetHs: number;
  ratioPct: number;
  gapHs: number;
  ausentismo: {
    prevYear: number;
    prevMonth: number;
    indice: number;
    indicePct: number;
    hsSinVac: number;
    modo: 'con_indice' | 'sin_indice';
  };
  guards: GuardCapacityRow[];
  shiftMix: ShiftMixRow[];
  conclusion: string;
};

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const sec = (v as { seconds?: number; _seconds?: number }).seconds
    ?? (v as { _seconds?: number })._seconds;
  if (typeof sec === 'number' && sec > 0) {
    const d = new Date(sec * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string' && v.trim()) {
    const core = v.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(core)) {
      const y = Number(core.slice(0, 4));
      const m = Number(core.slice(5, 7));
      const d = Number(core.slice(8, 10));
      const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function employeeDisplayName(emp: CapacityEmployeeInput): string {
  const n = String(emp.name || '').trim();
  if (n) return n;
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.id;
}

export function isActiveEmployeeStatus(status: unknown): boolean {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return true;
  return s === 'active' || s === 'activo' || s === 'a';
}

/** Años de antigüedad al cierre del mes (floor). */
export function yearsSeniorityAt(start: Date | null, asOf: Date): number {
  if (!start) return 0;
  let y = asOf.getFullYear() - start.getFullYear();
  const m = asOf.getMonth() - start.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < start.getDate())) y -= 1;
  return Math.max(0, y);
}

/** Días corridos de vacaciones CCT según antigüedad (tabla SUVICO). */
export function vacationCalendarDaysBySeniority(years: number): number {
  const rows = SUVICO_POLICY.VACATION.DAYS_BY_SENIORITY_YEARS;
  for (const row of rows) {
    if (years < row.maxYearsExclusive) return row.calendarDays;
  }
  return rows[rows.length - 1]?.calendarDays ?? 14;
}

export function normalizeShiftBandCode(raw: unknown): ShiftBandCode {
  const c = String(raw || '').trim().toUpperCase();
  if (c === 'M' || c === 'T' || c === 'N' || c === 'D12' || c === 'N12') return c;
  return 'SIN_TIPIFICAR';
}

export function schemeFromShiftCode(code: ShiftBandCode): { scheme: WorkScheme; jornadaHs: number; tipificado: boolean } {
  if (code === 'D12' || code === 'N12') {
    return { scheme: WorkScheme.FourTwo, jornadaHs: 12, tipificado: true };
  }
  if (code === 'M' || code === 'T' || code === 'N') {
    return { scheme: WorkScheme.SixTwo, jornadaHs: 8, tipificado: true };
  }
  return { scheme: WorkScheme.SixTwo, jornadaHs: 8, tipificado: false };
}

/**
 * Misma regla que Planificación: `preferredObjectiveId` puede ser el id del objetivo
 * o el id del documento SLA; también cuenta `planificacionDotacion[objetivo|sla]`.
 */
export function employeeBelongsToObjective(
  emp: CapacityEmployeeInput,
  objectiveId: string,
  serviceId?: string,
): boolean {
  const oid = String(objectiveId || '').trim();
  const sid = String(serviceId || '').trim();
  const pref = String(emp.preferredObjectiveId || '').trim();
  if (pref && oid && pref === oid) return true;
  if (pref && sid && pref === sid) return true;
  const dot = emp.planificacionDotacion || {};
  if (oid && dot[oid]) return true;
  if (sid && dot[sid]) return true;
  return false;
}

function resolveEmpShiftCode(
  emp: CapacityEmployeeInput,
  objectiveId: string,
  serviceId?: string,
): ShiftBandCode {
  const dot = emp.planificacionDotacion || {};
  const oid = String(objectiveId || '').trim();
  const sid = String(serviceId || '').trim();
  const entry = (oid && dot[oid]) || (sid && dot[sid]) || undefined;
  return normalizeShiftBandCode(entry?.shiftCode);
}

function slaShiftHints(positions: ServicePosition[] | undefined): Record<ShiftBandCode, string> {
  const hints: Record<ShiftBandCode, string> = {
    M: '',
    T: '',
    N: '',
    D12: '',
    N12: '',
    SIN_TIPIFICAR: 'Sin código en dotación',
  };
  const names: string[] = [];
  for (const p of positions || []) {
    const q = Math.max(1, Number(p.quantity) || 1);
    names.push(`${q}× ${p.name || 'Puesto'}`);
  }
  const joined = names.slice(0, 4).join('; ') || '—';
  hints.M = joined;
  hints.T = joined;
  hints.N = joined;
  hints.D12 = joined;
  hints.N12 = joined;
  return hints;
}

export function prevCalendarMonth(year: number, monthIndex0: number): { year: number; month: number } {
  if (monthIndex0 <= 0) return { year: year - 1, month: 11 };
  return { year, month: monthIndex0 - 1 };
}

export function monthBounds(year: number, monthIndex0: number): { start: Date; end: Date } {
  const start = new Date(year, monthIndex0, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex0 + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function buildServiceCapacityViability(opts: {
  service: Pick<ServiceSLA, 'startDate' | 'endDate' | 'positions' | 'excludedDates' | 'objectiveId'> & {
    id?: string;
  };
  employees: CapacityEmployeeInput[];
  year: number;
  /** 0–11 */
  month: number;
  ausenciasPrev?: any[];
  turnosPrev?: any[];
  tiposNovedad?: NovedadType[];
  /**
   * Si true, no vuelve a filtrar por preferido (la lista ya viene resuelta:
   * preferidos + dotación + asignaciones SLA + malla).
   */
  employeesAlreadyResolved?: boolean;
}): ServiceCapacityViability {
  const { service, year, month } = opts;
  const days = daysInCalendarMonth(year, month);
  const asOf = new Date(year, month + 1, 0, 12, 0, 0, 0);
  const objectiveId = String(service.objectiveId || '').trim();
  const serviceId = String(service.id || '').trim();

  const slaRow = calculateSlaHoursForMonth(
    service.positions || [],
    service.startDate || '',
    service.endDate || '',
    service.excludedDates,
    year,
    month,
  );
  const slaHsMonth = r1(slaRow.total);

  const preferred = (opts.employees || []).filter((e) => {
    if (!isActiveEmployeeStatus(e.status)) return false;
    if (opts.employeesAlreadyResolved) return true;
    if (!objectiveId && !serviceId) return true;
    return employeeBelongsToObjective(e, objectiveId, serviceId);
  });

  const prev = prevCalendarMonth(year, month);
  const prevBounds = monthBounds(prev.year, prev.month);
  const ausStats = preferred.length
    ? buildAusenciasStats({
        ausencias: opts.ausenciasPrev || [],
        turnos: opts.turnosPrev || [],
        employees: preferred,
        periodStart: prevBounds.start,
        periodEnd: prevBounds.end,
        capHsPerGuardPeriod: CCT_HS_TECHO_MENSUAL,
        tiposNovedad: opts.tiposNovedad || [],
      })
    : null;

  const hsSinVac = Math.max(0, (ausStats?.hsAfectadas ?? 0) - (ausStats?.vacHs ?? 0));
  const techoLookback = preferred.length * CCT_HS_TECHO_MENSUAL;
  const tieneHistorial = hsSinVac > 0 || (ausStats?.total ?? 0) > 0;
  const indiceRaw = tieneHistorial && techoLookback > 0 ? hsSinVac / techoLookback : 0;
  const indice = Math.min(1, Math.max(0, indiceRaw));
  const ausFactor = tieneHistorial ? 1 - indice : 1;

  const mixCount: Record<ShiftBandCode, number> = {
    M: 0, T: 0, N: 0, D12: 0, N12: 0, SIN_TIPIFICAR: 0,
  };

  const guards: GuardCapacityRow[] = preferred.map((emp) => {
    const start = toDate(emp.startDate) || toDate(emp.fechaIngreso);
    const years = yearsSeniorityAt(start, asOf);
    const vacYear = vacationCalendarDaysBySeniority(years);
    const vacDaysMonth = (vacYear * days) / 365;
    const code = resolveEmpShiftCode(emp, objectiveId, serviceId);
    const { scheme, jornadaHs, tipificado } = schemeFromShiftCode(code);
    const schemeHs = billableHoursOneHeadInMonth(days, scheme, 'rational_hours');
    const bruto = Math.min(CCT_HS_TECHO_MENSUAL, schemeHs);
    const vacHs = vacDaysMonth * jornadaHs;
    const afterVac = Math.max(0, bruto - vacHs);
    const net = afterVac * ausFactor;
    mixCount[code] += 1;
    return {
      employeeId: emp.id,
      name: employeeDisplayName(emp),
      yearsSeniority: years,
      vacationDaysYear: vacYear,
      vacationDaysMonthProrated: r1(vacDaysMonth),
      vacationHsMonth: r1(vacHs),
      shiftCode: code,
      scheme,
      jornadaHs,
      schemeHsMonth: r1(schemeHs),
      brutoCapHs: r1(bruto),
      netHs: r1(net),
      tipificado,
    };
  });

  guards.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const capacityBrutaHs = r1(guards.reduce((s, g) => s + g.brutoCapHs, 0));
  const capacityAfterVacHs = r1(guards.reduce((s, g) => s + Math.max(0, g.brutoCapHs - g.vacationHsMonth), 0));
  const capacityNetHs = r1(guards.reduce((s, g) => s + g.netHs, 0));
  const gapHs = r1(slaHsMonth - capacityNetHs);
  const ratioPct = slaHsMonth > 0 ? r1((capacityNetHs / slaHsMonth) * 100) : (preferred.length ? 100 : 0);

  const hints = slaShiftHints(service.positions);
  const shiftMix: ShiftMixRow[] = (Object.keys(mixCount) as ShiftBandCode[])
    .filter((c) => mixCount[c] > 0 || c === 'SIN_TIPIFICAR')
    .map((code) => ({ code, guards: mixCount[code], slaHint: hints[code] }))
    .filter((r) => r.guards > 0 || r.code !== 'SIN_TIPIFICAR');

  let conclusion: string;
  if (preferred.length === 0) {
    conclusion =
      'Sin plantilla vinculada al objetivo (preferredObjectiveId, planificacionDotacion ni malla del mes): no hay oferta de capacidad para contrastar el paquete SLA.';
  } else if (slaHsMonth <= 0) {
    conclusion = 'El servicio no genera horas SLA en este mes (fuera de vigencia o sin puestos computables).';
  } else if (gapHs <= 0) {
    conclusion = `Paquete cubierto: capacidad neta ${capacityNetHs} h ≥ SLA ${slaHsMonth} h (ratio ${ratioPct}%).`;
  } else {
    conclusion = `Faltan ${gapHs} h netas: SLA ${slaHsMonth} h vs capacidad ${capacityNetHs} h (ratio ${ratioPct}%).`;
  }

  return {
    year,
    month,
    daysInMonth: days,
    techoHs: CCT_HS_TECHO_MENSUAL,
    slaHsMonth,
    plantilla: preferred.length,
    capacityBrutaHs,
    capacityAfterVacHs,
    capacityNetHs,
    ratioPct,
    gapHs,
    ausentismo: {
      prevYear: prev.year,
      prevMonth: prev.month,
      indice,
      indicePct: r1(indice * 100),
      hsSinVac: r1(hsSinVac),
      modo: tieneHistorial ? 'con_indice' : 'sin_indice',
    },
    guards,
    shiftMix,
    conclusion,
  };
}

/** Ratio rápido sin ausentismo (para badge de grilla). */
export function quickCapacityRatioPct(
  service: Pick<ServiceSLA, 'startDate' | 'endDate' | 'positions' | 'excludedDates' | 'objectiveId'>,
  employees: CapacityEmployeeInput[],
  year: number,
  month: number,
): number | null {
  const v = buildServiceCapacityViability({
    service,
    employees,
    year,
    month,
  });
  if (v.slaHsMonth <= 0 && v.plantilla === 0) return null;
  return v.ratioPct;
}
