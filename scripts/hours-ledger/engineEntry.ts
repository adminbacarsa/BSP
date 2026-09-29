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
import { buildObjectiveOwnerIndex, resolveObjectiveOwner } from '@/lib/crm/objectiveClientOwner';
import {
  buildPersonaBook,
  calculateLiquidationHoursStatsF0,
} from '../../packages/hours-core/src/index';
import { assignWorkedShares, classifySlaBucket } from './slaPolicy';

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
};

const METRIC_KEYS = [
  'slaActive', 'slaInactive', 'slaClosed', 'slaWithoutPlan', 'planPublished', 'planDraft', 'worked', 'workedOutside',
  'covered', 'uncovered', 'ft', 'ext', 'adv', 'novedadPaga',
] as const;

const PAID_CODE: Record<string, 'V' | 'L' | 'E' | 'A' | 'PG'> = {
  V: 'V', VACACIONES: 'V',
  L: 'L', LICENCIA: 'L',
  E: 'E', ENFERMEDAD: 'E',
  A: 'A', AUTORIZADA: 'A',
  PG: 'PG', 'PERMISO GREMIAL': 'PG', GREMIAL: 'PG',
};

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
    covered: 0, uncovered: 0, ft: 0, ext: 0, adv: 0, novedadPaga: 0,
  };
}

function addMetrics(a: ReturnType<typeof blankMetrics>, b: Partial<ReturnType<typeof blankMetrics>>) {
  for (const k of METRIC_KEYS) a[k] = r1((Number(a[k]) || 0) + (Number(b[k]) || 0));
}

function paidCode(raw: unknown): string {
  return PAID_CODE[String(raw || '').trim().toUpperCase()] || '';
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
  // Dueño actual del objetivo dentro de la empresa (objetivos[].id), como el trigger I1.
  // El clientId del SLA/turno puede apuntar a un cliente borrado: no se usa para agrupar.
  const ownerIndex = buildObjectiveOwnerIndex(clients);
  const resolveClient = (objectiveId: string, sla?: any) => {
    const owner = resolveObjectiveOwner(ownerIndex, objectiveId, {
      objectiveName: sla?.objectiveName,
      clientName: sla?.clientName,
    });
    if (owner) {
      return { ...owner, client: ownerIndex.clientById.get(owner.clientId) };
    }
    return { clientId: '', clientName: String(sla?.clientName || ''), client: undefined as any };
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
        row.novedadPaga = r1(row.novedadPaga + jornadaPagada(t));
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
    if (!paidCode(a.type || a.codigo || a.code)) continue;
    const st = String(a.status || '').toLowerCase();
    if (st.includes('rechaz') || st.includes('injust')) continue;
    const oid = String(a.objectiveId || '').trim() || '_sin_objetivo';
    const start = dateStr(a.startDate) || dateStr(a.fecha);
    const end = dateStr(a.endDate) || start;
    for (const day of daysInRange(start, end, periodKey)) {
      const emp = String(a.employeeId || '');
      const key = `${emp}|${day}`;
      if (emp && paidDay.has(key)) continue;
      if (emp) paidDay.add(key);
      const row = touch(oid, 'novedad', 'Novedad', day, null);
      row.novedadPaga = r1(row.novedadPaga + 8);
      if (a.objectiveName) row.objectiveName = String(a.objectiveName);
    }
  }

  const reliefByObj = new Map<string, number>();
  for (const b of franja.buckets) {
    const oid = String(b.objectiveId || '').trim();
    if (!oid || !b.date?.startsWith(periodKey)) continue;
    if (only && !only.has(oid)) continue;
    const pid = puestoSlug(b.positionName, b.positionName);
    const row = touch(oid, pid, b.positionName || pid, b.date, null);
    row.covered = r1(row.covered + b.covered);
    let relief = 0;
    for (const tit of b.titulares || []) relief += Number(tit.fromFillers) || 0;
    reliefByObj.set(oid, r1((reliefByObj.get(oid) || 0) + relief));
    row.objectiveName = b.objectiveName || row.objectiveName;
  }

  const inOperationEarly = new Set<string>();
  for (const item of chosen.values()) {
    if (item.bucket === 'active' || item.bucket === 'closed') {
      inOperationEarly.add(String(item.srv.objectiveId || ''));
    }
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
      || d.covered || d.uncovered || d.ft || d.ext || d.adv || d.novedadPaga;
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
    m.worked = r1(m.worked + d.worked);
    m.workedOutside = r1(m.workedOutside + d.workedOutside);
    m.ft = r1(m.ft + d.ft);
    m.ext = r1(m.ext + d.ext);
    m.adv = r1(m.adv + d.adv);
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
      for (const d of objDays) { d.covered = 0; d.uncovered = 0; }
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
  }
  if (only) {
    for (const id of [...byObj.keys()]) {
      if (!only.has(id) && id !== '_sin_objetivo') byObj.delete(id);
    }
  }

  const monthlyObjs = [...byObj.values()].filter((m) =>
    m.slaActive || m.slaInactive || m.slaClosed || m.slaWithoutPlan || m.planPublished || m.planDraft
    || m.worked || m.workedOutside || m.covered || m.uncovered || m.ft || m.ext || m.adv || m.novedadPaga,
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
