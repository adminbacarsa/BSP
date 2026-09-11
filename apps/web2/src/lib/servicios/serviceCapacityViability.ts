/**
 * Viabilidad de capacidad por servicio: paquete SLA del mes vs oferta neta.
 * Neta = min(200, ciclo descanso CCT, 48 h/sem, cupo L–V/L–D/24h del objetivo)
 *        − vacaciones cobradas (max(V del mes, pendiente repartido hasta 31/12))
 *        × (1 − índice aus. mes ant. sin V).
 */

import type { ServicePosition, ServiceSLA } from '@/services/slaService';
import { SUVICO_POLICY } from '@/lib/planificacion/suvicoPolicy';
import {
  iterateCalendarDateRange,
  toCalendarDateStr,
} from '@/lib/planificacion/absenceCodes';
import { CCT_HS_TECHO_MENSUAL } from '@/lib/analisis/analisisBolsa';
import { buildAusenciasStats, resolveAbsenceCode, categoryFromAbsenceCode } from '@/lib/analisis/analisisQueries';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import {
  WorkScheme,
  billableHoursOneHeadInMonth,
  daysInCalendarMonth,
} from '@/lib/servicios/serviceMarginOptimizer';
import { calculateSlaHoursForMonth } from '@/lib/servicios/slaHoursCalculator';
import { resolveTurnoScheduleDateKey } from '@/lib/crm/crmDateUtils';

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
  /** Derecho anual CCT por antigüedad. */
  vacationDaysYear: number;
  /** Días V gozados/autorizados en el año hasta fin del mes. */
  vacationDaysTakenYtd: number;
  /** max(0, derecho − tomadas). */
  vacationDaysPending: number;
  /** Días V ya cargados que pisan el mes. */
  vacationDaysInMonth: number;
  /** Reserva prorrateada del pendiente sobre el resto del año (hasta 31/12). */
  vacationDaysReserveMonth: number;
  /** Días que restan capacidad este mes = max(V reales, reserva). */
  vacationDaysCharged: number;
  /** Horas restadas este mes = charged × jornada. */
  vacationHsMonth: number;
  /** Prorrateo 365 del derecho (solo referencia). */
  vacationDaysMonthProrated: number;
  shiftCode: ShiftBandCode;
  scheme: WorkScheme;
  jornadaHs: number;
  schemeHsMonth: number;
  brutoCapHs: number;
  netHs: number;
  tipificado: boolean;
};

export type CoverageCalendarKind = 'L_V' | 'L_S' | 'L_D' | 'H24';

export type ServiceCoverageProfile = {
  kind: CoverageCalendarKind;
  label: string;
  workDaysPerWeek: number;
  prefer12h: boolean;
  scheme: WorkScheme;
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
  weeklyCapHs: number;
  coverageProfile: ServiceCoverageProfile;
  slaHsMonth: number;
  plantilla: number;
  capacityBrutaHs: number;
  capacityAfterVacHs: number;
  capacityNetHs: number;
  ratioPct: number;
  /** SLA − neta (positivo = faltan). */
  gapHs: number;
  /** max(0, SLA − neta). */
  horasPerdidas: number;
  /** max(0, neta − SLA). */
  holguraHs: number;
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

function ymd(year: number, monthIndex0: number, day: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isRejectedAbsence(doc: any): boolean {
  const st = String(doc?.status || '').toLowerCase().trim();
  return st === 'rechazada' || st === 'rejected' || st === 'cancelada' || st === 'cancelled';
}

/** Vacaciones ya gozadas / autorizadas (no pendientes de aprobación). */
function isTakenVacationStatus(doc: any): boolean {
  const st = String(doc?.status || '').trim().toLowerCase();
  if (!st) return true;
  if (isRejectedAbsence(doc)) return false;
  if (st === 'pendiente' || st === 'pending') return false;
  return true;
}

function isVacationAbsenceDoc(doc: any, tiposNovedad: NovedadType[]): boolean {
  const code = resolveAbsenceCode(doc, tiposNovedad);
  if (code === 'V') return true;
  return categoryFromAbsenceCode(code, doc) === 'vac';
}

/** Días calendario de V del empleado que solapan [fromYmd, toYmd]. */
export function countVacationDaysInRange(opts: {
  ausencias: any[];
  employeeId: string;
  fromYmd: string;
  toYmd: string;
  tiposNovedad?: NovedadType[];
  /** taken = autorizadas/gozadas; any = también Pendiente; all non-rejected. */
  mode?: 'taken' | 'any';
}): number {
  const tipos = opts.tiposNovedad || [];
  const mode = opts.mode || 'any';
  const days = new Set<string>();
  for (const a of opts.ausencias || []) {
    if (String(a.employeeId || '') !== opts.employeeId) continue;
    if (isRejectedAbsence(a)) continue;
    if (!isVacationAbsenceDoc(a, tipos)) continue;
    if (mode === 'taken' && !isTakenVacationStatus(a)) continue;
    const s = toCalendarDateStr(a.startDate) || String(a.startDate || '').slice(0, 10);
    const e = toCalendarDateStr(a.endDate) || String(a.endDate || s).slice(0, 10);
    if (!s || !e) continue;
    const clipStart = s < opts.fromYmd ? opts.fromYmd : s;
    const clipEnd = e > opts.toYmd ? opts.toYmd : e;
    if (clipStart > clipEnd) continue;
    for (const d of iterateCalendarDateRange(clipStart, clipEnd)) days.add(d);
  }
  return days.size;
}

/** Celdas V en malla del mes para un empleado. */
export function countVacationShiftDaysInMonth(
  turnos: any[],
  employeeId: string,
  year: number,
  monthIndex0: number,
): number {
  const prefix = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-`;
  const days = new Set<string>();
  for (const t of turnos || []) {
    if (String(t.employeeId || '') !== employeeId) continue;
    const code = String(t.code || t.type || '').trim().toUpperCase();
    if (code !== 'V') continue;
    const key = resolveTurnoScheduleDateKey(t);
    if (key && key.startsWith(prefix)) days.add(key);
  }
  return days.size;
}

const WEEKLY_CAP_HS = SUVICO_POLICY.ALERTS.WEEK_BILLABLE_HOURS_DEFAULT; // 48

/**
 * Calendario del objetivo según puestos SLA (L–V / L–S / L–D / 24h).
 * El ciclo 6×2 / 4×2 modela interjornada ~12 h y descanso ≥35 h tras racha 48 h.
 */
export function inferServiceCoverageProfile(
  positions: ServicePosition[] | undefined,
): ServiceCoverageProfile {
  const pos = (positions || []).filter(
    (p) => String(p.status || 'ACTIVE').toUpperCase() !== 'INACTIVE' && p.coverageType !== 'eventos',
  );
  let has24 = false;
  let has12 = false;
  const dayHits: Record<string, number> = { L: 0, M: 0, X: 0, J: 0, V: 0, S: 0, D: 0 };
  for (const p of pos) {
    if (p.coverageType === '24hs') has24 = true;
    if (p.coverageType === '12hs_diurno' || p.coverageType === '12hs_nocturno') has12 = true;
    const ads = p.activeDays?.length ? p.activeDays : ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    for (const d of ads) {
      const k = String(d).toUpperCase();
      if (k in dayHits) dayHits[k] += 1;
    }
    for (const sh of p.allowedShiftTypes || []) {
      const c = String(sh.code || '').toUpperCase();
      if (c === 'D12' || c === 'N12' || Number(sh.hours) >= 12) has12 = true;
    }
  }
  const weekday = dayHits.L + dayHits.M + dayHits.X + dayHits.J + dayHits.V;
  const sat = dayHits.S;
  const sun = dayHits.D;
  if (has24 || (weekday > 0 && sat > 0 && sun > 0)) {
    return {
      kind: 'H24',
      label: '24 h / L–D',
      workDaysPerWeek: 7,
      prefer12h: has12,
      scheme: has12 ? WorkScheme.FourTwo : WorkScheme.SixTwo,
    };
  }
  if (weekday > 0 && sat > 0 && sun === 0) {
    return {
      kind: 'L_S',
      label: 'L–S',
      workDaysPerWeek: 6,
      prefer12h: has12,
      scheme: has12 ? WorkScheme.FourTwo : WorkScheme.SixOne,
    };
  }
  if (weekday > 0 && sat === 0 && sun === 0) {
    return {
      kind: 'L_V',
      label: 'L–V',
      workDaysPerWeek: 5,
      prefer12h: false,
      scheme: WorkScheme.SixOne,
    };
  }
  return {
    kind: 'L_D',
    label: 'L–D',
    workDaysPerWeek: 7,
    prefer12h: has12,
    scheme: has12 ? WorkScheme.FourTwo : WorkScheme.SixTwo,
  };
}

/**
 * Hs brutas/mes: min(techo 200, ciclo descanso CCT, tope 48 h/sem, cupo del calendario del objetivo).
 */
export function baseBillableHsForMonth(opts: {
  daysInMonth: number;
  profile: ServiceCoverageProfile;
  jornadaHs: number;
  scheme: WorkScheme;
}): number {
  const { daysInMonth, profile, jornadaHs, scheme } = opts;
  const cycleHs = billableHoursOneHeadInMonth(daysInMonth, scheme, 'rational_hours');
  const weeklyCapMonth = (daysInMonth / 7) * WEEKLY_CAP_HS;
  const objWeekly = Math.min(WEEKLY_CAP_HS, profile.workDaysPerWeek * jornadaHs);
  const objMonth = (daysInMonth / 7) * objWeekly;
  return Math.min(CCT_HS_TECHO_MENSUAL, cycleHs, weeklyCapMonth, objMonth);
}

/**
 * Vacaciones del mes: no descuenta los 14 de golpe.
 * Reparte el pendiente (derecho − tomadas) desde el 1º del mes hasta el 31/12,
 * y cobra max(V ya cargadas en el mes, cuota prorrateada).
 */
export function vacationChargeDaysForMonth(opts: {
  pendingDays: number;
  actualVacDaysInMonth: number;
  daysInMonth: number;
  year: number;
  monthIndex0: number;
}): { chargeDays: number; reserveProrated: number; daysLeftInYear: number } {
  const monthStart = new Date(opts.year, opts.monthIndex0, 1, 12, 0, 0, 0);
  const yearEnd = new Date(opts.year, 11, 31, 12, 0, 0, 0);
  const daysLeft = Math.max(1, Math.round((yearEnd.getTime() - monthStart.getTime()) / 86400000) + 1);
  const reserveProrated = Math.max(0, opts.pendingDays) * (opts.daysInMonth / daysLeft);
  const chargeDays = Math.max(opts.actualVacDaysInMonth, reserveProrated);
  return { chargeDays, reserveProrated, daysLeftInYear: daysLeft };
}

export function dominantShiftFromMalla(
  turnos: any[],
  employeeId: string,
  year: number,
  monthIndex0: number,
): ShiftBandCode {
  const prefix = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-`;
  const counts: Partial<Record<ShiftBandCode, number>> = {};
  for (const t of turnos || []) {
    if (String(t.employeeId || '') !== employeeId) continue;
    const key = resolveTurnoScheduleDateKey(t);
    if (!key || !key.startsWith(prefix)) continue;
    const code = normalizeShiftBandCode(t.code || t.type);
    if (code === 'SIN_TIPIFICAR') continue;
    counts[code] = (counts[code] || 0) + 1;
  }
  let best: ShiftBandCode = 'SIN_TIPIFICAR';
  let n = 0;
  (Object.keys(counts) as ShiftBandCode[]).forEach((c) => {
    if ((counts[c] || 0) > n) {
      n = counts[c] || 0;
      best = c;
    }
  });
  return best;
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
  /** Ausencias del año (o al menos YTD) para saldo V tomadas/pendientes y V del mes. */
  ausenciasVac?: any[];
  turnosPrev?: any[];
  /** Turnos del mes (para celdas V en malla). */
  turnosMes?: any[];
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
  const tipos = opts.tiposNovedad || [];
  const ausVac = opts.ausenciasVac || [];
  const turnosMes = opts.turnosMes || [];
  const ytdFrom = ymd(year, 0, 1);
  const ytdTo = ymd(year, month, days);
  const monthFrom = ymd(year, month, 1);
  const monthTo = ytdTo;
  const coverageProfile = inferServiceCoverageProfile(service.positions);

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
        tiposNovedad: tipos,
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
    const vacDaysMonthProrated = (vacYear * days) / 365;
    const takenYtd = countVacationDaysInRange({
      ausencias: ausVac,
      employeeId: emp.id,
      fromYmd: ytdFrom,
      toYmd: ytdTo,
      tiposNovedad: tipos,
      mode: 'taken',
    });
    const pending = Math.max(0, vacYear - takenYtd);
    const vacDaysAusMes = countVacationDaysInRange({
      ausencias: ausVac,
      employeeId: emp.id,
      fromYmd: monthFrom,
      toYmd: monthTo,
      tiposNovedad: tipos,
      mode: 'any',
    });
    const vacDaysMalla = countVacationShiftDaysInMonth(turnosMes, emp.id, year, month);
    const vacDaysInMonth = Math.max(vacDaysAusMes, vacDaysMalla);
    const { chargeDays, reserveProrated } = vacationChargeDaysForMonth({
      pendingDays: pending,
      actualVacDaysInMonth: vacDaysInMonth,
      daysInMonth: days,
      year,
      monthIndex0: month,
    });

    let code = resolveEmpShiftCode(emp, objectiveId, serviceId);
    let tipificado = code !== 'SIN_TIPIFICAR';
    if (!tipificado) {
      const fromMalla = dominantShiftFromMalla(turnosMes, emp.id, year, month);
      if (fromMalla !== 'SIN_TIPIFICAR') {
        code = fromMalla;
        tipificado = true;
      }
    }
    const fromCode = schemeFromShiftCode(code);
    const scheme = tipificado ? fromCode.scheme : coverageProfile.scheme;
    const jornadaHs = tipificado
      ? fromCode.jornadaHs
      : coverageProfile.prefer12h
        ? 12
        : 8;
    const schemeHs = baseBillableHsForMonth({
      daysInMonth: days,
      profile: coverageProfile,
      jornadaHs,
      scheme,
    });
    const bruto = Math.min(CCT_HS_TECHO_MENSUAL, schemeHs);
    const vacHs = chargeDays * jornadaHs;
    const afterVac = Math.max(0, bruto - vacHs);
    const net = afterVac * ausFactor;
    mixCount[code] += 1;
    return {
      employeeId: emp.id,
      name: employeeDisplayName(emp),
      yearsSeniority: years,
      vacationDaysYear: vacYear,
      vacationDaysTakenYtd: takenYtd,
      vacationDaysPending: pending,
      vacationDaysInMonth: vacDaysInMonth,
      vacationDaysReserveMonth: r1(reserveProrated),
      vacationDaysCharged: r1(chargeDays),
      vacationHsMonth: r1(vacHs),
      vacationDaysMonthProrated: r1(vacDaysMonthProrated),
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
  const horasPerdidas = r1(Math.max(0, gapHs));
  const holguraHs = r1(Math.max(0, -gapHs));
  const ratioPct = slaHsMonth > 0 ? r1((capacityNetHs / slaHsMonth) * 100) : (preferred.length ? 100 : 0);

  const hints = slaShiftHints(service.positions);
  const shiftMix: ShiftMixRow[] = (Object.keys(mixCount) as ShiftBandCode[])
    .filter((c) => mixCount[c] > 0 || c === 'SIN_TIPIFICAR')
    .map((code) => ({ code, guards: mixCount[code], slaHint: hints[code] }))
    .filter((r) => r.guards > 0 || r.code !== 'SIN_TIPIFICAR');

  const vacChargeTotal = r1(guards.reduce((s, g) => s + g.vacationDaysCharged, 0));
  let conclusion: string;
  if (preferred.length === 0) {
    conclusion =
      'Sin plantilla vinculada al objetivo (preferredObjectiveId, planificacionDotacion ni malla del mes): no hay oferta de capacidad para contrastar el paquete SLA.';
  } else if (slaHsMonth <= 0) {
    conclusion = 'El servicio no genera horas SLA en este mes (fuera de vigencia o sin puestos computables).';
  } else if (gapHs <= 0) {
    conclusion =
      `Paquete cubierto: neta ${capacityNetHs} h ≥ SLA ${slaHsMonth} h (holgura ${holguraHs} h). ` +
      `Objetivo ${coverageProfile.label}; tope ${WEEKLY_CAP_HS} h/sem + descanso ciclo; ` +
      `vacaciones cobradas ${vacChargeTotal} d (pendiente repartido hasta 31/12, no los 14 de golpe).`;
  } else {
    conclusion =
      `Hs perdidas ${horasPerdidas} h (SLA ${slaHsMonth} − neta ${capacityNetHs}). ` +
      `Objetivo ${coverageProfile.label}; vacaciones cobradas ${vacChargeTotal} d (cuota del pendiente hasta 31/12).`;
  }

  return {
    year,
    month,
    daysInMonth: days,
    techoHs: CCT_HS_TECHO_MENSUAL,
    weeklyCapHs: WEEKLY_CAP_HS,
    coverageProfile,
    slaHsMonth,
    plantilla: preferred.length,
    capacityBrutaHs,
    capacityAfterVacHs,
    capacityNetHs,
    ratioPct,
    gapHs,
    horasPerdidas,
    holguraHs,
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
