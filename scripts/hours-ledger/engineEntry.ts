/**
 * Libro de horas — una sola fórmula para el callable, el cron y el dry-run.
 * SLA / plan salen de los mismos helpers que Servicios, CRM y Análisis.
 * Trabajadas: persona de hours-core si hoursCoreEnabled; si no, motor F0.
 */
import { calculateMonthlyBreakdown } from '@/lib/servicios/slaHoursCalculator';
import { pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import {
  buildDemandaByObjective,
  coveragePlannedFromDemandaRow,
} from '@/lib/analisis/analisisDemanda';
import { buildObjectiveAliasesFromSla } from '@/lib/hoursBalance/buildHoursBalance';
import { buildSlaExclusionContext } from '@/lib/crm/slaExclusionForPlanned';
import { executedBillableHoursByFranja } from '@/lib/crm/executedBillableHoursByFranja';
import { calcPlanificadorShiftHours } from '@/lib/planificacion/planningScheduledHours';
import {
  buildPersonaBook,
  calculateLiquidationHoursStatsF0,
} from '../../packages/hours-core/src/index';
import { assignWorkedShares, classifySlaBucket } from './slaPolicy';
import {
  billableGaps,
  billableHoursForContract,
  normalizeSlaBillingMode,
  prorateFixedMonthlyHours,
  purchaseOrderAuthorizedHours,
  resolveSlaBillingMode,
} from '@/lib/crm/slaBilling';
import type { PurchaseOrder } from '@/lib/crm/slaBilling.types';

export { assignWorkedShares };

export type LedgerPlanMode = 'published' | 'draft' | 'both';

export type LedgerDay = {
  empresaId: string;
  periodKey: string;
  date: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  puestoId: string;
  puestoName: string;
  slaActive: number;
  slaInactive: number;
  slaClosed: number;
  slaWithoutPlan: number;
  planPublished: number;
  planDraft: number;
  worked: number;
  workedOutside: number;
  covered: number;
  uncovered: number;
  ft: number;
  ext: number;
  adv: number;
  novedadPaga: number;
  novedadPagaOutside: number;
  licV: number;
  licE: number;
  licL: number;
  licA: number;
  licPG: number;
  licSUS: number;
  licSGS: number;
  ausenciaHoras: number;
  ausenciaHorasOutside: number;
  ausenciaTurnos: number;
  ausenciaTurnosOutside: number;
  ausenciaLegajos: number;
  uncoveredAusencia: number;
  uncoveredRetiro: number;
  uncoveredFaltaPlan: number;
  billable: number;
  workedNotBilled: number;
  billedNotWorked: number;
};

export type LedgerMonth = {
  empresaId: string;
  periodKey: string;
  level: 'empresa' | 'cliente' | 'objetivo';
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  slaActive: number;
  slaInactive: number;
  slaClosed: number;
  slaWithoutPlan: number;
  planPublished: number;
  planDraft: number;
  worked: number;
  workedOutside: number;
  covered: number;
  uncovered: number;
  ft: number;
  ext: number;
  adv: number;
  novedadPaga: number;
  novedadPagaOutside: number;
  licV: number;
  licE: number;
  licL: number;
  licA: number;
  licPG: number;
  licSUS: number;
  licSGS: number;
  ausenciaHoras: number;
  ausenciaHorasOutside: number;
  ausenciaTurnos: number;
  ausenciaTurnosOutside: number;
  ausenciaLegajos: number;
  uncoveredAusencia: number;
  uncoveredRetiro: number;
  uncoveredFaltaPlan: number;
  billable: number;
  workedNotBilled: number;
  billedNotWorked: number;
  /** Modo del contrato vigente. No se suma entre niveles. */
  billingMode?: string;
  /** Horas fijas ya prorrateadas al mes. */
  billingFixedHours?: number;
  billingHasCap?: boolean;
  billingAuthorizedHours?: number;
  hoursCoreEnabled: boolean;
};

export type LedgerBuildInput = {
  empresaId: string;
  year: number;
  month: number;
  hoursCoreEnabled: boolean;
  clients: any[];
  slas: any[];
  turnos: any[];
  ausencias: any[];
  publishStatusMap: Record<string, boolean>;
  empNameById: Record<string, string>;
  /** Si viene, el resultado solo incluye esos objetivos (una tanda). */
  onlyObjectiveIds?: string[];
  /** La tanda no corre el motor de persona; el cierre del job lo hace una vez. */
  skipPersona?: boolean;
  /** Ausencias pagas sin objectiveId. Solo el build completo o la primera tanda. */
  includeUnscopedPaidAbsences?: boolean;
  /** Contratos comerciales (`contracts`) para el modo Auto. */
  contracts?: any[];
  /** Órdenes de compra del período. */
  purchaseOrders?: any[];
};

const METRIC_KEYS = [
  'slaActive', 'slaInactive', 'slaClosed', 'slaWithoutPlan', 'planPublished', 'planDraft', 'worked', 'workedOutside',
  'covered', 'uncovered', 'ft', 'ext', 'adv', 'novedadPaga', 'novedadPagaOutside',
  'licV', 'licE', 'licL', 'licA', 'licPG', 'licSUS', 'licSGS',
  'ausenciaHoras', 'ausenciaHorasOutside', 'ausenciaTurnos', 'ausenciaTurnosOutside', 'ausenciaLegajos',
  'uncoveredAusencia', 'uncoveredRetiro', 'uncoveredFaltaPlan',
  'billable', 'workedNotBilled', 'billedNotWorked',
] as const;

/** Códigos que van a la tarjeta Licencias (desglose). AA queda afuera: es Ausencias, no paga. */
const LIC_CODE_FIELD: Record<string, 'licV' | 'licE' | 'licL' | 'licA' | 'licPG' | 'licSUS' | 'licSGS'> = {
  V: 'licV', VACACIONES: 'licV',
  L: 'licL', LICENCIA: 'licL',
  E: 'licE', ENFERMEDAD: 'licE',
  A: 'licA', AUTORIZADA: 'licA', ART: 'licA',
  PG: 'licPG', 'PERMISO GREMIAL': 'licPG', GREMIAL: 'licPG',
  SUS: 'licSUS', SUSPENSION: 'licSUS', 'SUSPENSIÓN': 'licSUS',
  SGS: 'licSGS', 'SIN GOCE': 'licSGS', 'SIN GOCE DE SUELDO': 'licSGS',
};

function paidCode(raw: unknown): string {
  const c = String(raw || '').trim().toUpperCase();
  return LIC_CODE_FIELD[c] ? c : '';
}

const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function monthKey(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

function lastDay(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function eachDay(year: number, month: number): string[] {
  const n = lastDay(year, month);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) out.push(ymd(year, month, d));
  return out;
}

function arRange(year: number, month: number) {
  const end = lastDay(year, month);
  return {
    start: new Date(`${year}-${pad(month)}-01T00:00:00.000-03:00`),
    end: new Date(`${year}-${pad(month)}-${pad(end)}T23:59:59.999-03:00`),
  };
}

function positionsOf(srv: any): any[] {
  if (Array.isArray(srv?.positions)) return srv.positions;
  return Object.values(srv?.positions || {});
}

function clientActivo(status: unknown): boolean {
  const u = String(status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE' || u === '';
}

function contractActive(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  if (!st) return true;
  return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}

function dateStr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  const d = typeof o.toDate === 'function'
    ? o.toDate()
    : (typeof (o.seconds ?? o._seconds) === 'number' ? new Date(((o.seconds ?? o._seconds) as number) * 1000) : null);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function overlapsMonth(start: string, end: string, year: number, month: number) {
  const from = `${year}-${pad(month)}-01`;
  const to = ymd(year, month, lastDay(year, month));
  const s = start || '1970-01-01';
  const e = end || '2099-12-31';
  return s <= to && e >= from;
}

function prorate(srv: any, year: number, month: number): number {
  const start = dateStr(srv.startDate);
  const end = dateStr(srv.endDate) || '2099-12-31';
  const from = start > ymd(year, month, 1) ? start : ymd(year, month, 1);
  const toM = ymd(year, month, lastDay(year, month));
  const to = end < toM ? end : toM;
  if (!start || from > to) return 0;
  const rows = calculateMonthlyBreakdown(positionsOf(srv), from, to, srv.excludedDates);
  return Math.round(rows.reduce((a: number, m: { totalHours: number }) => a + m.totalHours, 0));
}

function dayHours(srv: any, day: string): number {
  const start = dateStr(srv.startDate);
  const end = dateStr(srv.endDate) || '2099-12-31';
  if (!start || day < start || day > end) return 0;
  const rows = calculateMonthlyBreakdown(positionsOf(srv), day, day, srv.excludedDates);
  return rows.reduce((a: number, m: { totalHours: number }) => a + m.totalHours, 0);
}

function puestoSlug(name: string, id: string) {
  const raw = String(id || name || 'puesto').trim() || 'puesto';
  return raw.replace(/[/\s#?[\]]+/g, '_').slice(0, 80);
}

function blankMetrics() {
  return {
    slaActive: 0, slaInactive: 0, slaClosed: 0, slaWithoutPlan: 0,
    planPublished: 0, planDraft: 0, worked: 0, workedOutside: 0,
    covered: 0, uncovered: 0, ft: 0, ext: 0, adv: 0, novedadPaga: 0, novedadPagaOutside: 0,
    licV: 0, licE: 0, licL: 0, licA: 0, licPG: 0, licSUS: 0, licSGS: 0,
    ausenciaHoras: 0, ausenciaHorasOutside: 0, ausenciaTurnos: 0, ausenciaTurnosOutside: 0, ausenciaLegajos: 0,
    uncoveredAusencia: 0, uncoveredRetiro: 0, uncoveredFaltaPlan: 0,
    billable: 0, workedNotBilled: 0, billedNotWorked: 0,
  };
}

/**
 * Facturable según el modo guardado en la fila (horas fijas ya prorrateadas, tope de OC ya resuelto).
 * El cierre del job lo vuelve a correr después de reclamar trabajadas y cubiertas.
 */
export function applyBillableOnRow(m: {
  billingMode?: string;
  planPublished?: number;
  covered?: number;
  worked?: number;
  billingFixedHours?: number;
  billingHasCap?: boolean;
  billingAuthorizedHours?: number | null;
  billable?: number;
  workedNotBilled?: number;
  billedNotWorked?: number;
}) {
  if (!m.billingMode) {
    m.billable = 0;
    m.workedNotBilled = 0;
    m.billedNotWorked = 0;
    return;
  }
  const priced = billableHoursForContract({
    mode: normalizeSlaBillingMode(m.billingMode),
    planHours: Number(m.planPublished) || 0,
    coveredHours: Number(m.covered) || 0,
    fixedMonthlyHours: Number(m.billingFixedHours) || 0,
    contractStart: '2000-01-01',
    contractEnd: '2000-01-01',
    periodStartYmd: '2000-01-01',
    periodEndYmd: '2000-01-01',
    authorizedHours: m.billingHasCap ? Number(m.billingAuthorizedHours) || 0 : null,
  });
  const gaps = billableGaps(Number(m.worked) || 0, priced.billableHours);
  m.billable = priced.billableHours;
  m.workedNotBilled = gaps.workedNotBilled;
  m.billedNotWorked = gaps.billedNotWorked;
}

function addMetrics(a: ReturnType<typeof blankMetrics>, b: Partial<ReturnType<typeof blankMetrics>>) {
  for (const k of METRIC_KEYS) a[k] = r1((Number(a[k]) || 0) + (Number(b[k]) || 0));
}

type LiquidationPart = {
  employeeId: string;
  objectiveId: string;
  date: string;
  worked: number;
  ft: number;
  ext: number;
  adv: number;
};

/** Peso para repartir trabajadas. No cambia el total de persona. */
function weightHours(t: any): number {
  const a = instantMs(t?.realStartTime) ?? instantMs(t?.checkInTime);
  const b = instantMs(t?.realEndTime) ?? instantMs(t?.checkOutTime);
  if (a != null && b != null && b !== a) {
    let dur = (b - a) / 3600000;
    if (dur < 0) dur += 24;
    if (dur > 0 && dur <= 24) return dur;
  }
  const h = Number(t?.hours) || 0;
  return h > 0 ? h : 0;
}

function instantMs(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const o = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof o.toDate === 'function') {
    const d = o.toDate();
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const sec = o.seconds ?? o._seconds;
  return typeof sec === 'number' ? sec * 1000 : null;
}

/** Jornada paga: 8 o 12 h del turno. Nunca 24 h de calendario. */
export function jornadaPagada(t: any): number {
  const h = Number(t?.hours);
  if (h === 8 || h === 9 || h === 12) return h;
  const a = instantMs(t?.startTime);
  const b = instantMs(t?.endTime);
  if (a != null && b != null && b !== a) {
    let dur = (b - a) / 3600000;
    if (dur <= 0) dur += 24;
    if (dur >= 11 && dur <= 13) return 12;
    return 8;
  }
  const band = String(t?.band || t?.baseCode || t?.shiftBand || '').toUpperCase();
  if (band === 'D12' || band === 'N12' || band === 'PU') return 12;
  return 8;
}

function daysInRange(start: string, end: string, periodKey: string): string[] {
  const s = start.slice(0, 10);
  const e = (end || start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return [];
  const out: string[] = [];
  let [y, m, d] = s.split('-').map(Number);
  for (let i = 0; i < 62; i++) {
    const key = ymd(y, m, d);
    if (key > e) break;
    if (key.startsWith(periodKey)) out.push(key);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return out;
}

/** Jornada real por empleado/día (desde la malla) + jornada típica del empleado, para licencias sin turno ese día. */
function buildJornadaLookup(turnos: any[]): {
  byEmpDay: Map<string, number>;
  typicalByEmp: Map<string, number>;
} {
  const byEmpDay = new Map<string, number>();
  const counts = new Map<string, Map<number, number>>();
  for (const t of turnos) {
    const emp = String(t?.employeeId || '').trim();
    if (!emp || emp === 'VACANTE') continue;
    const day = (dateStr(t?.scheduleDate) || dateStr(t?.startTime) || '').slice(0, 10);
    const hs = jornadaPagada(t);
    if (day) byEmpDay.set(`${emp}|${day}`, hs);
    const m = counts.get(emp) || new Map<number, number>();
    m.set(hs, (m.get(hs) || 0) + 1);
    counts.set(emp, m);
  }
  const typicalByEmp = new Map<string, number>();
  for (const [emp, m] of counts) {
    let best = 8;
    let bestN = -1;
    for (const [hs, n] of m) {
      if (n > bestN) { best = hs; bestN = n; }
    }
    typicalByEmp.set(emp, best);
  }
  return { byEmpDay, typicalByEmp };
}

export function personaMonthWorked(input: {
  turnos: any[];
  ausencias: any[];
  publishStatusMap: Record<string, boolean>;
  year: number;
  month: number;
  hoursCoreEnabled: boolean;
  empNameById: Record<string, string>;
}): { worked: number; weights: Record<string, number>; parts: LiquidationPart[] } {
  const active = (input.turnos || []).filter((t) => {
    const st = String(t.status || '');
    return st !== 'Canceled' && st !== 'CANCELED';
  });
  let worked = 0;
  const parts: LiquidationPart[] = [];
  if (input.hoursCoreEnabled) {
    const persona = buildPersonaBook({
      turnos: active,
      ausencias: input.ausencias || [],
      publishStatusMap: input.publishStatusMap,
      rangeStartYmd: ymd(input.year, input.month, 1),
      rangeEndYmd: ymd(input.year, input.month, lastDay(input.year, input.month)),
      empNameById: input.empNameById,
      holidays: {},
      usePlannedHours: false,
      publishFilter: 'published',
    });
    for (const e of persona.employees) {
      worked += Number(e.stats?.horasReales) || 0;
      const rows = (e.stats as { parts?: LiquidationPart[] })?.parts || [];
      for (const p of rows) parts.push(p);
    }
  } else {
    const byEmp = new Map<string, any[]>();
    for (const t of active) {
      const id = String(t.employeeId || '').trim();
      if (!id || id === 'VACANTE' || !input.empNameById[id]) continue;
      const list = byEmp.get(id) || [];
      list.push(t);
      byEmp.set(id, list);
    }
    for (const shifts of byEmp.values()) {
      const stats = calculateLiquidationHoursStatsF0(shifts, {}, { usePlannedHours: false });
      worked += Number(stats?.horasReales) || 0;
    }
  }
  const weights: Record<string, number> = {};
  for (const p of parts) {
    const oid = String(p.objectiveId || '').trim();
    if (!oid || !(p.worked > 0)) continue;
    weights[oid] = (weights[oid] || 0) + p.worked;
  }
  if (!Object.keys(weights).length) {
    for (const t of active) {
      const oid = String(t.objectiveId || '').trim();
      const hs = weightHours(t);
      if (!oid || !(hs > 0)) continue;
      weights[oid] = (weights[oid] || 0) + hs;
    }
  }
  return { worked: r1(worked), weights, parts };
}

export function planHoursOf(mode: LedgerPlanMode, row: { planPublished: number; planDraft: number }) {
  if (mode === 'draft') return row.planDraft;
  if (mode === 'both') return r1(row.planPublished + row.planDraft);
  return row.planPublished;
}

export function buildLedgerMonth(input: LedgerBuildInput): {
  days: LedgerDay[];
  monthly: LedgerMonth[];
  totals: ReturnType<typeof blankMetrics>;
} {
  const { empresaId, year, month, hoursCoreEnabled, clients, slas, publishStatusMap, empNameById } = input;
  const periodKey = monthKey(year, month);
  const only = input.onlyObjectiveIds?.length ? new Set(input.onlyObjectiveIds.map((id) => String(id))) : null;
  const turnos = input.turnos;
  const ausencias = only
    ? input.ausencias.filter((a) => {
      const oid = String(a.objectiveId || '').trim();
      if (!oid) return input.includeUnscopedPaidAbsences === true;
      return only.has(oid);
    })
    : input.ausencias;
  const suffix = `_${year}_${month}`;
  const publishedObj = new Set<string>();
  for (const [k, v] of Object.entries(publishStatusMap)) {
    if (v && k.endsWith(suffix)) publishedObj.add(k.slice(0, -suffix.length));
  }
  const { start, end } = arRange(year, month);
  const clientById = new Map(clients.map((c) => [String(c.id), c]));

  const normName = (v: unknown) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const ownerByObjective = new Map<string, { clientId: string; clientName: string }>();
  const ownerByObjName = new Map<string, { clientId: string; clientName: string }>();
  for (const c of clients) {
    const objs = c.objetivos || c.objectives || [];
    const meta = { clientId: String(c.id), clientName: String(c.name || c.razonSocial || '') };
    for (const o of objs) {
      const id = String(o?.id || o?.objectiveId || '').trim();
      const name = normName(o?.name || o?.nombre);
      if (id && !ownerByObjective.has(id)) ownerByObjective.set(id, meta);
      if (name && !ownerByObjName.has(name)) ownerByObjName.set(name, meta);
    }
  }

  const clientByName = new Map<string, any>();
  for (const c of clients) {
    const n = normName(c.name || c.razonSocial);
    if (n && !clientByName.has(n)) clientByName.set(n, c);
  }

  const resolveClient = (objectiveId: string, sla?: any) => {
    const fromSla = String(sla?.clientId || '').trim();
    const direct = fromSla ? clientById.get(fromSla) : undefined;
    if (direct) {
      return { clientId: fromSla, clientName: String(direct.name || direct.razonSocial || sla?.clientName || ''), client: direct };
    }
    const owner = ownerByObjective.get(objectiveId) || ownerByObjName.get(normName(sla?.objectiveName));
    if (owner) {
      return { ...owner, client: clientById.get(owner.clientId) };
    }
    const byName = clientByName.get(normName(sla?.clientName));
    if (byName) {
      return { clientId: String(byName.id), clientName: String(byName.name || byName.razonSocial || ''), client: byName };
    }
    return { clientId: fromSla, clientName: String(sla?.clientName || ''), client: undefined as any };
  };

  type Bucket = 'active' | 'inactive' | 'closed' | 'withoutPlan';
  const chosen = new Map<string, { srv: any; bucket: Bucket; hours: number }>();

  const consider = (srv: any, bucket: Bucket) => {
    const oid = String(srv.objectiveId || '').trim();
    if (!oid) return;
    if (only && !only.has(oid)) return;
    const startS = dateStr(srv.startDate);
    const endS = dateStr(srv.endDate);
    if (!overlapsMonth(startS, endS, year, month)) return;
    const prev = chosen.get(`${bucket}:${oid}`);
    if (!prev || startS.localeCompare(dateStr(prev.srv.startDate)) > 0) {
      chosen.set(`${bucket}:${oid}`, { srv, bucket, hours: 0 });
    }
  };

  for (const srv of slas) {
    const closed = srv.closed === true;
    const active = contractActive(srv.status);
    const who = resolveClient(String(srv.objectiveId || ''), srv);
    const activoCli = who.client ? clientActivo(who.client.status) : clientActivo(undefined);
    const bucket = classifySlaBucket({
      closed,
      contractActive: active,
      clientActive: activoCli,
      hasPublishedPlan: publishedObj.has(String(srv.objectiveId || '').trim()),
    });
    consider(srv, bucket);
  }
  for (const row of chosen.values()) row.hours = prorate(row.srv, year, month);

  const prepared = slas.map((s) => ({ ...s, positions: positionsOf(s) }));
  const vigente = pickVigenteSlasForPeriod(prepared, start, end);
  const aliases = buildObjectiveAliasesFromSla(vigente);
  const slaExclusionCtx = buildSlaExclusionContext(prepared, start, end);
  const activeTurnos = turnos.filter((t) => {
    const st = String(t.status || '');
    return st !== 'Canceled' && st !== 'CANCELED';
  });
  const publishedTurnos = activeTurnos.filter((t) => t.draft !== true && publishedObj.has(String(t.objectiveId || '')));
  const draftTurnos = activeTurnos.filter((t) => t.draft === true || !publishedObj.has(String(t.objectiveId || '')));

  const demandaOf = (list: any[]) => buildDemandaByObjective({
    turnos: list,
    ausenciasStats: null,
    vigenteServices: vigente,
    periodStart: start,
    periodEnd: end,
    objectiveAliases: aliases,
    slaExclusionCtx,
  });
  const demPub = demandaOf(publishedTurnos);
  const demDraft = demandaOf(draftTurnos);

  const persona = personaMonthWorked({ turnos, ausencias, publishStatusMap, year, month, hoursCoreEnabled, empNameById });
  const worked = persona.worked;

  const franja = executedBillableHoursByFranja(activeTurnos);
  const daysMap = new Map<string, LedgerDay>();
  const touch = (objectiveId: string, puestoId: string, puestoName: string, date: string, sla?: any) => {
    const key = `${objectiveId}|${puestoId}|${date}`;
    let row = daysMap.get(key);
    if (row) return row;
    const who = resolveClient(objectiveId, sla);
    row = {
      empresaId, periodKey, date,
      clientId: who.clientId,
      clientName: who.clientName,
      objectiveId,
      objectiveName: String(sla?.objectiveName || objectiveId),
      puestoId, puestoName,
      ...blankMetrics(),
    };
    daysMap.set(key, row);
    return row;
  };

  for (const item of chosen.values()) {
    const oid = String(item.srv.objectiveId || '').trim();
    const positions = positionsOf(item.srv);
    const list = positions.length ? positions : [{ id: 'puesto', name: 'Puesto' }];
    for (const day of eachDay(year, month)) {
      const h = dayHours({ ...item.srv, positions: list }, day);
      if (!(h > 0)) continue;
      const share = list.length ? h / list.length : h;
      list.forEach((p: any, i: number) => {
        const pid = puestoSlug(String(p?.name || p?.code || ''), String(p?.id || i));
        const row = touch(oid, pid, String(p?.name || p?.code || pid), day, item.srv);
        const part = i === list.length - 1 ? r1(h - share * (list.length - 1)) : r1(share);
        if (item.bucket === 'active') row.slaActive = r1(row.slaActive + part);
        else if (item.bucket === 'inactive') row.slaInactive = r1(row.slaInactive + part);
        else if (item.bucket === 'withoutPlan') row.slaWithoutPlan = r1(row.slaWithoutPlan + part);
        else row.slaClosed = r1(row.slaClosed + part);
      });
    }
  }

  /** Mismo universo que trabajadas: solo objetivos con contrato activo o cerrado del mes. */
  const inOperationEarly = new Set<string>();
  for (const item of chosen.values()) {
    if (item.bucket === 'active' || item.bucket === 'closed') {
      inOperationEarly.add(String(item.srv.objectiveId || ''));
    }
  }

  const jornadaLookup = buildJornadaLookup(turnos);
  const bumpLicencia = (row: LedgerDay, code: string, hs: number) => {
    const field = LIC_CODE_FIELD[code];
    if (!field) return;
    row[field] = r1(row[field] + hs);
    row.novedadPaga = r1(row.novedadPaga + hs);
    if (!inOperationEarly.has(row.objectiveId)) row.novedadPagaOutside = r1(row.novedadPagaOutside + hs);
  };

  const paidDay = new Set<string>();
  const planOn = (list: any[], field: 'planPublished' | 'planDraft') => {
    for (const t of list) {
      const oid = String(t.objectiveId || '').trim();
      if (!oid) continue;
      const code = String(t.code || t.type || '').toUpperCase();
      if (paidCode(code)) {
        const when = (dateStr(t.scheduleDate) || dateStr(t.startTime) || ymd(year, month, 1)).slice(0, 10);
        const day = when.startsWith(periodKey) ? when : ymd(year, month, 1);
        const emp = String(t.employeeId || '');
        const key = `${emp}|${day}`;
        if (emp && paidDay.has(key)) continue;
        if (emp) paidDay.add(key);
        const row = touch(oid, 'novedad', 'Novedad', day, null);
        bumpLicencia(row, code, jornadaPagada(t));
        continue;
      }
      const hs = calcPlanificadorShiftHours(t);
      if (!(hs > 0)) continue;
      const when = dateStr(t.startTime);
      const day = when && when.startsWith(periodKey) ? when : ymd(year, month, 1);
      const pid = puestoSlug(String(t.positionName || ''), String(t.positionId || t.positionName || 'puesto'));
      const row = touch(oid, pid, String(t.positionName || pid), day, null);
      row[field] = r1(row[field] + hs);
    }
  };
  planOn(publishedTurnos, 'planPublished');
  planOn(draftTurnos, 'planDraft');

  for (const a of ausencias) {
    const code = paidCode(a.type || a.codigo || a.code);
    if (!code) continue;
    const st = String(a.status || '').toLowerCase();
    if (st.includes('rechaz') || st.includes('injust')) continue;
    const oid = String(a.objectiveId || '').trim() || '_sin_objetivo';
    const start = dateStr(a.startDate) || dateStr(a.fecha);
    const end = dateStr(a.endDate) || start;
    const emp = String(a.employeeId || '').trim();
    for (const day of daysInRange(start, end, periodKey)) {
      const key = `${emp}|${day}`;
      if (emp && paidDay.has(key)) continue;
      if (emp) paidDay.add(key);
      const row = touch(oid, 'novedad', 'Novedad', day, null);
      const hs = emp
        ? (jornadaLookup.byEmpDay.get(key) ?? jornadaLookup.typicalByEmp.get(emp) ?? 8)
        : 8;
      bumpLicencia(row, code, hs);
      if (a.objectiveName) row.objectiveName = String(a.objectiveName);
    }
  }

  /** Ausencias (AA): turnos publicados con falta sin justificar. No pagas. */
  const ausenciaLegajosByObj = new Map<string, Set<string>>();
  for (const t of publishedTurnos) {
    if (t.isAbsent !== true) continue;
    const code = String(t.code || t.type || '').toUpperCase();
    if (paidCode(code)) continue;
    const oid = String(t.objectiveId || '').trim();
    if (!oid) continue;
    const when = dateStr(t.startTime);
    const day = when && when.startsWith(periodKey) ? when : ymd(year, month, 1);
    const row = touch(oid, 'ausencia', 'Ausencia AA', day, null);
    const hs = jornadaPagada(t);
    row.ausenciaHoras = r1(row.ausenciaHoras + hs);
    row.ausenciaTurnos += 1;
    if (!inOperationEarly.has(oid)) {
      row.ausenciaHorasOutside = r1(row.ausenciaHorasOutside + hs);
      row.ausenciaTurnosOutside += 1;
    }
    const emp = String(t.employeeId || '').trim();
    if (emp && emp !== 'VACANTE') {
      const set = ausenciaLegajosByObj.get(oid) || new Set<string>();
      set.add(emp);
      ausenciaLegajosByObj.set(oid, set);
    }
  }

  const turnoById = new Map<string, any>(turnos.map((t: any) => [String(t.id || ''), t]));
  const ausenciaGapByObj = new Map<string, number>();
  const retiroGapByObj = new Map<string, number>();
  const reliefByObj = new Map<string, number>();
  for (const b of franja.buckets) {
    const oid = String(b.objectiveId || '').trim();
    if (!oid || !b.date?.startsWith(periodKey)) continue;
    if (only && !only.has(oid)) continue;
    const pid = puestoSlug(b.positionName, b.positionName);
    const row = touch(oid, pid, b.positionName || pid, b.date, null);
    row.covered = r1(row.covered + b.covered);
    let relief = 0;
    for (const tit of b.titulares || []) {
      relief += Number(tit.fromFillers) || 0;
      const gap = r1(Math.max(0, (Number(tit.requested) || 0) - (Number(tit.covered) || 0)));
      if (gap <= 0) continue;
      const shift = turnoById.get(String(tit.shiftId || ''));
      if (shift?.isAbsent === true) {
        row.uncoveredAusencia = r1(row.uncoveredAusencia + gap);
        ausenciaGapByObj.set(oid, r1((ausenciaGapByObj.get(oid) || 0) + gap));
      } else {
        row.uncoveredRetiro = r1(row.uncoveredRetiro + gap);
        retiroGapByObj.set(oid, r1((retiroGapByObj.get(oid) || 0) + gap));
      }
    }
    reliefByObj.set(oid, r1((reliefByObj.get(oid) || 0) + relief));
    row.objectiveName = b.objectiveName || row.objectiveName;
  }

  for (const p of persona.parts || []) {
    if (!p.date?.startsWith(periodKey)) continue;
    const oid = String(p.objectiveId || '').trim() || '_sin_objetivo';
    if (only && !only.has(oid) && oid !== '_sin_objetivo') continue;
    const row = touch(oid, 'liq', 'Liquidación', p.date, null);
    const inside = inOperationEarly.has(oid);
    if (p.worked > 0) {
      if (inside) row.worked = r1(row.worked + p.worked);
      else row.workedOutside = r1(row.workedOutside + p.worked);
    }
    if (p.ft > 0) row.ft = r1(row.ft + p.ft);
    if (p.ext > 0) row.ext = r1(row.ext + p.ext);
    if (p.adv > 0) row.adv = r1(row.adv + p.adv);
  }

  const days = [...daysMap.values()].filter((d) => {
    if (only && !only.has(d.objectiveId) && d.objectiveId !== '_sin_objetivo') return false;
    return d.slaActive || d.slaInactive || d.slaClosed || d.slaWithoutPlan || d.planPublished || d.planDraft
      || d.worked || d.workedOutside
      || d.covered || d.uncovered || d.ft || d.ext || d.adv || d.novedadPaga
      || d.ausenciaHoras || d.ausenciaTurnos;
  });

  const byObj = new Map<string, LedgerMonth>();
  const ensureObj = (d: LedgerDay) => {
    let m = byObj.get(d.objectiveId);
    if (!m) {
      m = {
        empresaId, periodKey, level: 'objetivo',
        clientId: d.clientId, clientName: d.clientName,
        objectiveId: d.objectiveId, objectiveName: d.objectiveName,
        hoursCoreEnabled, ...blankMetrics(),
      };
      byObj.set(d.objectiveId, m);
    }
    if (!m.clientId && d.clientId) {
      m.clientId = d.clientId;
      m.clientName = d.clientName;
    }
    return m;
  };

  for (const item of chosen.values()) {
    const oid = String(item.srv.objectiveId || '');
    const who = resolveClient(oid, item.srv);
    const stub: LedgerDay = {
      empresaId, periodKey, date: ymd(year, month, 1),
      clientId: who.clientId, clientName: who.clientName,
      objectiveId: oid, objectiveName: String(item.srv.objectiveName || oid),
      puestoId: '_', puestoName: '_', ...blankMetrics(),
    };
    const m = ensureObj(stub);
    if (item.bucket === 'active') m.slaActive = r1(item.hours);
    else if (item.bucket === 'inactive') m.slaInactive = r1(m.slaInactive + item.hours);
    else if (item.bucket === 'withoutPlan') m.slaWithoutPlan = r1(m.slaWithoutPlan + item.hours);
    else m.slaClosed = r1(m.slaClosed + item.hours);
  }

  for (const r of demPub.rows) {
    const m = ensureObj({
      empresaId, periodKey, date: ymd(year, month, 1),
      clientId: '', clientName: r.client || '',
      objectiveId: r.id, objectiveName: r.name || r.id,
      puestoId: '_', puestoName: '_', ...blankMetrics(),
    });
    m.planPublished = r1(coveragePlannedFromDemandaRow(r));
    const who = resolveClient(r.id, null);
    if (who.clientId) {
      m.clientId = who.clientId;
      m.clientName = who.clientName || m.clientName;
    }
  }
  for (const r of demDraft.rows) {
    const m = ensureObj({
      empresaId, periodKey, date: ymd(year, month, 1),
      clientId: '', clientName: r.client || '',
      objectiveId: r.id, objectiveName: r.name || r.id,
      puestoId: '_', puestoName: '_', ...blankMetrics(),
    });
    m.planDraft = r1(coveragePlannedFromDemandaRow(r));
    const who = resolveClient(r.id, null);
    if (who.clientId) {
      m.clientId = who.clientId;
      m.clientName = who.clientName || m.clientName;
    }
  }

  for (const d of days) {
    const m = ensureObj(d);
    if (!m) continue;
    m.covered = r1(m.covered + d.covered);
    m.uncovered = r1(m.uncovered + d.uncovered);
    m.novedadPaga = r1(m.novedadPaga + d.novedadPaga);
    m.novedadPagaOutside = r1(m.novedadPagaOutside + d.novedadPagaOutside);
    m.licV = r1(m.licV + d.licV);
    m.licE = r1(m.licE + d.licE);
    m.licL = r1(m.licL + d.licL);
    m.licA = r1(m.licA + d.licA);
    m.licPG = r1(m.licPG + d.licPG);
    m.licSUS = r1(m.licSUS + d.licSUS);
    m.licSGS = r1(m.licSGS + d.licSGS);
    m.ausenciaHoras = r1(m.ausenciaHoras + d.ausenciaHoras);
    m.ausenciaHorasOutside = r1(m.ausenciaHorasOutside + d.ausenciaHorasOutside);
    m.ausenciaTurnos += d.ausenciaTurnos;
    m.ausenciaTurnosOutside += d.ausenciaTurnosOutside;
    m.worked = r1(m.worked + d.worked);
    m.workedOutside = r1(m.workedOutside + d.workedOutside);
    m.ft = r1(m.ft + d.ft);
    m.ext = r1(m.ext + d.ext);
    m.adv = r1(m.adv + d.adv);
  }
  for (const [oid, set] of ausenciaLegajosByObj) {
    const m = byObj.get(oid);
    if (m) m.ausenciaLegajos = set.size;
  }

  for (const m of byObj.values()) m.slaActive = r1(m.slaActive + m.slaClosed);
  for (const d of days) d.slaActive = r1(d.slaActive + d.slaClosed);

  for (const m of byObj.values()) {
    if (!(m.slaActive > 0)) {
      m.covered = 0;
      m.uncovered = 0;
    } else {
      m.covered = r1(Math.min(Math.max(0, m.covered), m.slaActive));
      const relief = r1(reliefByObj.get(m.objectiveId) || 0);
      (m as LedgerMonth & { reliefHours?: number }).reliefHours = relief;
      const allowance = r1(m.worked + relief);
      if (m.covered > allowance) m.covered = allowance;
      m.uncovered = r1(Math.max(0, m.slaActive - m.covered));
    }
    let ausenciaGap = ausenciaGapByObj.get(m.objectiveId) || 0;
    let retiroGap = retiroGapByObj.get(m.objectiveId) || 0;
    const knownGap = r1(ausenciaGap + retiroGap);
    if (knownGap > m.uncovered && knownGap > 0) {
      const scale = m.uncovered / knownGap;
      ausenciaGap = r1(ausenciaGap * scale);
      retiroGap = r1(retiroGap * scale);
    }
    m.uncoveredAusencia = ausenciaGap;
    m.uncoveredRetiro = retiroGap;
    /** Residual: SLA sin ningún titular planificado (gap_* de la grilla). Garantiza la invariante por construcción. */
    m.uncoveredFaltaPlan = r1(Math.max(0, m.uncovered - ausenciaGap - retiroGap));
  }
  const daysByObj = new Map<string, LedgerDay[]>();
  for (const d of days) {
    const list = daysByObj.get(d.objectiveId) || [];
    list.push(d);
    daysByObj.set(d.objectiveId, list);
  }
  for (const [oid, objDays] of daysByObj) {
    const m = byObj.get(oid);
    if (!m || !(m.slaActive > 0)) {
      for (const d of objDays) {
        d.covered = 0;
        d.uncovered = 0;
        d.uncoveredAusencia = 0;
        d.uncoveredRetiro = 0;
        d.uncoveredFaltaPlan = 0;
      }
      continue;
    }
    const slaSum = objDays.reduce((s, d) => s + (d.slaActive || 0), 0);
    if (slaSum > 0 && Math.abs(slaSum - m.slaActive) > 0.05) {
      let acc = 0;
      objDays.forEach((d, i) => {
        const part = i === objDays.length - 1 ? r1(m.slaActive - acc) : r1(m.slaActive * ((d.slaActive || 0) / slaSum));
        d.slaActive = Math.max(0, part);
        acc = r1(acc + d.slaActive);
      });
    } else if (!(slaSum > 0) && objDays[0]) {
      objDays[0].slaActive = m.slaActive;
    }
    const base = objDays.reduce((s, d) => s + (d.slaActive || 0), 0) || 1;
    let accC = 0;
    objDays.forEach((d, i) => {
      const cov = i === objDays.length - 1 ? r1(m.covered - accC) : r1(m.covered * ((d.slaActive || 0) / base));
      d.covered = r1(Math.min(Math.max(0, cov), d.slaActive || 0));
      d.uncovered = r1(Math.max(0, (d.slaActive || 0) - d.covered));
      accC = r1(accC + d.covered);
    });
    const sumPair = objDays.reduce((s, d) => s + d.covered + d.uncovered, 0);
    const driftPair = r1(m.slaActive - sumPair);
    if (objDays.length && driftPair) {
      const last = objDays[objDays.length - 1];
      last.slaActive = r1(last.slaActive + driftPair);
      last.uncovered = r1(last.uncovered + driftPair);
    }
    /**
     * Reparte las causas del mes entre los días proporcional al descubierto final de cada día.
     * Clampeado al descubierto propio del día: la invariante por día importa más que la
     * proporción exacta (el residuo de redondeo cae en falta de planificación).
     */
    const uncoveredBase = objDays.reduce((s, d) => s + (d.uncovered || 0), 0);
    objDays.forEach((d) => {
      const dayUncovered = d.uncovered || 0;
      const share = uncoveredBase > 0 ? dayUncovered / uncoveredBase : 0;
      const a = Math.min(Math.max(0, r1(m.uncoveredAusencia * share)), dayUncovered);
      const r = Math.min(Math.max(0, r1(m.uncoveredRetiro * share)), r1(dayUncovered - a));
      d.uncoveredAusencia = a;
      d.uncoveredRetiro = r;
      d.uncoveredFaltaPlan = r1(Math.max(0, dayUncovered - a - r));
    });
  }
  if (only) {
    for (const id of [...byObj.keys()]) {
      if (!only.has(id) && id !== '_sin_objetivo') byObj.delete(id);
    }
  }

  const openClients = new Set<string>();
  for (const c of input.contracts || []) {
    if (String(c?.type ?? '') === 'abierto' && String(c?.status ?? '').toUpperCase() !== 'INACTIVE') {
      const cid = String(c.clientId || '').trim();
      if (cid) openClients.add(cid);
    }
  }
  const ocById = new Map((input.purchaseOrders || []).map((o) => [String(o.id), o as PurchaseOrder]));
  const billingSrv = new Map<string, any>();
  for (const item of chosen.values()) {
    if (item.bucket !== 'active' && item.bucket !== 'closed') continue;
    const oid = String(item.srv.objectiveId || '');
    const prev = billingSrv.get(oid);
    if (!prev || item.bucket === 'active') billingSrv.set(oid, item.srv);
  }
  const periodStart = ymd(year, month, 1);
  const periodEnd = ymd(year, month, lastDay(year, month));
  for (const m of byObj.values()) {
    const srv = billingSrv.get(m.objectiveId);
    if (!srv) continue;
    const mode = resolveSlaBillingMode(srv, { clientHasOpenContract: openClients.has(m.clientId) });
    m.billingMode = mode;
    const cap = mode === 'ORDEN_COMPRA'
      ? purchaseOrderAuthorizedHours(
        ocById.get(String(srv.billingPurchaseOrderId || '').trim()),
        m.objectiveId,
        periodStart,
        periodEnd,
      )
      : null;
    m.billingHasCap = cap != null;
    if (cap != null) m.billingAuthorizedHours = cap;
    m.billingFixedHours = mode === 'FIJO'
      ? prorateFixedMonthlyHours(
        Number(srv.billingFixedMonthlyHours) || 0,
        dateStr(srv.startDate),
        dateStr(srv.endDate) || '2099-12-31',
        periodStart,
        periodEnd,
      )
      : 0;
    applyBillableOnRow(m);
  }

  const monthlyObjs = [...byObj.values()].filter((m) =>
    m.slaActive || m.slaInactive || m.slaClosed || m.slaWithoutPlan || m.planPublished || m.planDraft
    || m.worked || m.workedOutside || m.covered || m.uncovered || m.ft || m.ext || m.adv || m.novedadPaga
    || m.ausenciaHoras || m.ausenciaTurnos || m.billable || m.workedNotBilled || m.billedNotWorked,
  );

  const empresa = blankMetrics();
  for (const m of monthlyObjs) addMetrics(empresa, m);
  const outsideGap = r1(worked - empresa.worked - empresa.workedOutside);
  if (outsideGap) empresa.workedOutside = r1(empresa.workedOutside + outsideGap);

  const empresaDoc: LedgerMonth = {
    empresaId, periodKey, level: 'empresa',
    clientId: '', clientName: '', objectiveId: '', objectiveName: '',
    hoursCoreEnabled, ...empresa,
  };

  const byClient = new Map<string, LedgerMonth>();
  for (const m of monthlyObjs) {
    const cid = m.clientId || '_sin_cliente';
    let c = byClient.get(cid);
    if (!c) {
      c = {
        empresaId, periodKey, level: 'cliente',
        clientId: m.clientId, clientName: m.clientName || (cid === '_sin_cliente' ? 'Sin cliente' : cid),
        objectiveId: '', objectiveName: '',
        hoursCoreEnabled, ...blankMetrics(),
      };
      byClient.set(cid, c);
    }
    addMetrics(c, m);
  }

  return {
    days,
    monthly: [empresaDoc, ...byClient.values(), ...monthlyObjs],
    totals: empresa,
  };
}
