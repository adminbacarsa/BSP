/**
 * Viabilidad demanda SLA vs dotación elegible (Análisis operativo).
 * Horas/demanda SLA: mismo motor que Servicios, Dashboard y CRM.
 */

import { slaHoursForPositionOnDay } from '@/lib/servicios/slaHoursCalculator';
import type { ServicePosition } from '@/services/slaService';

const JS_DAY_MAP = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

/** Horas de cobertura de un puesto en un día calendario (0 si fuera de vigencia del servicio). */
export function hoursForPositionOnDay(
  pos: ServicePosition,
  day: Date,
  srvStartStr: string,
  srvEndStr: string,
  excludedDates?: string[],
): number {
  return slaHoursForPositionOnDay(pos, day, srvStartStr, srvEndStr, excludedDates);
}

/** Pax en paralelo requeridos ese día (suma quantity por puesto con cobertura > 0). */
export function requiredConcurrentPaxForServiceDay(
  srv: { startDate?: string; endDate?: string; positions?: ServicePosition[]; excludedDates?: string[] },
  day: Date,
): number {
  if (!srv.startDate || !srv.endDate) return 0;
  let pax = 0;
  for (const pos of srv.positions || []) {
    const h = hoursForPositionOnDay(pos, day, srv.startDate, srv.endDate, srv.excludedDates);
    if (h > 0) pax += pos.quantity ?? 1;
  }
  return pax;
}

function toDayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function absenceCoversDay(a: {
  employeeId?: string;
  startDate?: { seconds?: number } | string;
  endDate?: { seconds?: number } | string;
}, day: Date): boolean {
  if (!a.employeeId) return false;
  const sd =
    typeof a.startDate === 'object' && a.startDate && 'seconds' in a.startDate
      ? new Date((a.startDate as { seconds: number }).seconds * 1000)
      : new Date(String(a.startDate || ''));
  const ed =
    typeof a.endDate === 'object' && a.endDate && 'seconds' in a.endDate
      ? new Date((a.endDate as { seconds: number }).seconds * 1000)
      : new Date(String(a.endDate || ''));
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return false;
  const t = toDayStart(day);
  return toDayStart(sd) <= t && t <= toDayStart(ed);
}

export function employeeEligibleForService(
  emp: {
    restriccionesObjetivo?: Array<{ objectiveId?: string; objectiveName?: string }>;
    restriccionesCliente?: Array<{ clientId?: string }>;
  },
  clientId: string,
  objectiveId: string,
  objectiveName: string,
): boolean {
  const objRestr = (emp.restriccionesObjetivo || []).find(
    (r) =>
      r.objectiveId === objectiveId ||
      (!!objectiveName && r.objectiveName === objectiveName),
  );
  if (objRestr) return false;
  const clientRestr = (emp.restriccionesCliente || []).find((r) => r.clientId === clientId);
  if (clientRestr) return false;
  return true;
}

const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
const LICENCIA_CODES = new Set(['V', 'L', 'E', 'A', 'AA', 'PG']);

type TurnoLike = {
  employeeId?: string;
  objectiveId?: string;
  code?: string;
  isFranco?: boolean;
  startTime?: { seconds?: number } | Date | string | null;
};

function turnoDay(t: TurnoLike): Date | null {
  const st = t?.startTime as any;
  if (!st) return null;
  if (st && typeof st === 'object' && 'seconds' in st && typeof st.seconds === 'number') {
    return new Date(st.seconds * 1000);
  }
  if (st instanceof Date) return st;
  const d = new Date(String(st));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ViabilityDayRow = {
  date: Date;
  dayLabel: string;
  letter: string;
  requiredPax: number;
  eligiblePool: number;
  absentThatDay: number;
  francoThatDay: number;
  licenciaThatDay: number;
  enOtroObjThatDay: number;
  noDisponibleThatDay: number;
  availablePax: number;
  gap: number;
  inContract: boolean;
};

export type ViabilityMonthSummary = {
  rows: ViabilityDayRow[];
  peakRequired: number;
  minAvailable: number;
  deficitDays: number;
  worstGap: number;
  eligiblePool: number;
};

export function buildViabilityRangeReport(
  srv: { startDate?: string; endDate?: string; positions?: ServicePosition[]; excludedDates?: string[]; clientId?: string; objectiveId?: string; objectiveName?: string },
  rangeStart: Date,
  rangeEnd: Date,
  employees: Array<{
    id: string;
    restriccionesObjetivo?: Array<{ objectiveId?: string; objectiveName?: string }>;
    restriccionesCliente?: Array<{ clientId?: string }>;
  }>,
  ausencias: Array<{ employeeId?: string; startDate?: unknown; endDate?: unknown }>,
  turnos: TurnoLike[] = [],
): ViabilityMonthSummary {
  const clientId = String(srv.clientId || '');
  const objectiveId = String(srv.objectiveId || '');
  const objectiveName = String(srv.objectiveName || '');

  const eligible = employees.filter((e) =>
    employeeEligibleForService(e, clientId, objectiveId, objectiveName),
  );
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const eligiblePool = eligible.length;

  const start = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), 12, 0, 0, 0);
  const end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 12, 0, 0, 0);

  type DayBuckets = {
    franco: Set<string>;
    licencia: Set<string>;
    enOtroObj: Set<string>;
  };
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const buckets = new Map<string, DayBuckets>();
  const ensure = (k: string): DayBuckets => {
    let b = buckets.get(k);
    if (!b) {
      b = { franco: new Set(), licencia: new Set(), enOtroObj: new Set() };
      buckets.set(k, b);
    }
    return b;
  };
  for (const t of turnos) {
    const eid = t.employeeId;
    if (!eid || !eligibleIds.has(eid)) continue;
    const d = turnoDay(t);
    if (!d) continue;
    const k = dayKey(d);
    const b = ensure(k);
    const code = String(t.code || '').trim().toUpperCase();
    if (FRANCO_CODES.has(code) || (t.isFranco === true && !LICENCIA_CODES.has(code))) {
      b.franco.add(eid);
      continue;
    }
    if (LICENCIA_CODES.has(code)) {
      b.licencia.add(eid);
      continue;
    }
    const oid = String(t.objectiveId || '').trim();
    if (oid && oid !== objectiveId) b.enOtroObj.add(eid);
  }

  const rows: ViabilityDayRow[] = [];
  let peakRequired = 0;
  let minAvailable = Infinity;
  let deficitDays = 0;
  let worstGap = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
    const requiredPax = requiredConcurrentPaxForServiceDay(srv, day);
    const inContract =
      requiredPax > 0 ||
      (() => {
        if (!srv.startDate || !srv.endDate) return false;
        const sStart = parseYmd(srv.startDate);
        const sEnd = parseYmd(srv.endDate);
        return day >= sStart && day <= sEnd;
      })();

    const ausenciaIds = new Set<string>();
    for (const a of ausencias) {
      if (!a.employeeId || !eligibleIds.has(a.employeeId)) continue;
      if (absenceCoversDay(a, day)) ausenciaIds.add(a.employeeId);
    }
    const b = buckets.get(dayKey(day));
    const noDisp = new Set<string>(ausenciaIds);
    if (b) {
      b.franco.forEach((id) => noDisp.add(id));
      b.licencia.forEach((id) => noDisp.add(id));
      b.enOtroObj.forEach((id) => noDisp.add(id));
    }

    const absentThatDay = ausenciaIds.size;
    const francoThatDay = b?.franco.size ?? 0;
    const licenciaThatDay = b?.licencia.size ?? 0;
    const enOtroObjThatDay = b?.enOtroObj.size ?? 0;
    const noDisponibleThatDay = noDisp.size;
    const availablePax = Math.max(0, eligiblePool - noDisponibleThatDay);
    const gap = requiredPax - availablePax;

    const dayLabel = `${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}`;
    const letter = JS_DAY_MAP[day.getDay()];

    rows.push({
      date: day,
      dayLabel,
      letter,
      requiredPax,
      eligiblePool,
      absentThatDay,
      francoThatDay,
      licenciaThatDay,
      enOtroObjThatDay,
      noDisponibleThatDay,
      availablePax,
      gap,
      inContract,
    });

    if (requiredPax > 0) {
      peakRequired = Math.max(peakRequired, requiredPax);
      minAvailable = Math.min(minAvailable, availablePax);
      if (gap > 0) {
        deficitDays++;
        worstGap = Math.max(worstGap, gap);
      }
    }
  }

  if (minAvailable === Infinity) minAvailable = eligiblePool;

  return {
    rows,
    peakRequired,
    minAvailable,
    deficitDays,
    worstGap,
    eligiblePool,
  };
}

export function buildViabilityMonthReport(
  srv: { startDate?: string; endDate?: string; positions?: ServicePosition[]; excludedDates?: string[]; clientId?: string; objectiveId?: string; objectiveName?: string },
  year: number,
  month: number,
  employees: Array<{
    id: string;
    restriccionesObjetivo?: Array<{ objectiveId?: string; objectiveName?: string }>;
    restriccionesCliente?: Array<{ clientId?: string }>;
  }>,
  ausencias: Array<{ employeeId?: string; startDate?: unknown; endDate?: unknown }>,
  turnos: TurnoLike[] = [],
): ViabilityMonthSummary {
  const mStart = new Date(year, month, 1, 12, 0, 0, 0);
  const mEnd = new Date(year, month + 1, 0, 12, 0, 0, 0);
  return buildViabilityRangeReport(srv, mStart, mEnd, employees, ausencias, turnos);
}
