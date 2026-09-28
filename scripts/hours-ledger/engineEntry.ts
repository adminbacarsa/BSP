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
  planPublished: number;
  planDraft: number;
  worked: number;
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
  planPublished: number;
  planDraft: number;
  worked: number;
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
};

const PAID = new Set(['V', 'L', 'E', 'A', 'PG']);
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
    slaActive: 0, slaInactive: 0, slaClosed: 0,
    planPublished: 0, planDraft: 0, worked: 0,
    covered: 0, uncovered: 0, ft: 0, ext: 0, adv: 0, novedadPaga: 0,
  };
}

function addMetrics(a: ReturnType<typeof blankMetrics>, b: Partial<ReturnType<typeof blankMetrics>>) {
  (Object.keys(a) as (keyof ReturnType<typeof blankMetrics>)[]).forEach((k) => {
    a[k] = r1(a[k] + (Number(b[k]) || 0));
  });
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
  const { empresaId, year, month, hoursCoreEnabled, clients, slas, turnos, ausencias, publishStatusMap, empNameById } = input;
  const periodKey = monthKey(year, month);
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

  type Bucket = 'active' | 'inactive' | 'closed';
  const chosen = new Map<string, { srv: any; bucket: Bucket; hours: number }>();

  const consider = (srv: any, bucket: Bucket) => {
    const oid = String(srv.objectiveId || '').trim();
    if (!oid) return;
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
    if (closed && active) consider(srv, 'closed');
    else if (!active) consider(srv, 'inactive');
    else if (!activoCli) consider(srv, 'inactive');
    else consider(srv, 'active');
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
  const suffix = `_${year}_${month}`;
  const publishedObj = new Set<string>();
  for (const [k, v] of Object.entries(publishStatusMap)) {
    if (v && k.endsWith(suffix)) publishedObj.add(k.slice(0, -suffix.length));
  }
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

  let worked = 0;
  if (hoursCoreEnabled) {
    const persona = buildPersonaBook({
      turnos: activeTurnos,
      ausencias,
      publishStatusMap,
      rangeStartYmd: ymd(year, month, 1),
      rangeEndYmd: ymd(year, month, lastDay(year, month)),
      empNameById,
      holidays: {},
      usePlannedHours: false,
      publishFilter: 'published',
    });
    for (const e of persona.employees) worked += Number(e.stats?.horasReales) || 0;
  } else {
    const byEmp = new Map<string, any[]>();
    for (const t of activeTurnos) {
      const id = String(t.employeeId || '').trim();
      if (!id || id === 'VACANTE' || !empNameById[id]) continue;
      const list = byEmp.get(id) || [];
      list.push(t);
      byEmp.set(id, list);
    }
    for (const shifts of byEmp.values()) {
      const stats = calculateLiquidationHoursStatsF0(shifts, {}, { usePlannedHours: false });
      worked += Number(stats?.horasReales) || 0;
    }
  }
  worked = r1(worked);

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
        else row.slaClosed = r1(row.slaClosed + part);
      });
    }
  }

  const planOn = (list: any[], field: 'planPublished' | 'planDraft') => {
    for (const t of list) {
      const oid = String(t.objectiveId || '').trim();
      if (!oid) continue;
      const hs = calcPlanificadorShiftHours(t);
      if (!(hs > 0)) continue;
      const code = String(t.code || t.type || '').toUpperCase();
      if (PAID.has(code)) {
        const day = dateStr(t.startTime) || ymd(year, month, 1);
        const row = touch(oid, 'novedad', 'Novedad', day.slice(0, 10) > periodKey ? ymd(year, month, 1) : (dateStr(t.scheduleDate) || day).slice(0, 10), null);
        row.novedadPaga = r1(row.novedadPaga + hs);
        continue;
      }
      const when = dateStr(t.startTime);
      const day = when && when.startsWith(periodKey) ? when : ymd(year, month, 1);
      const pid = puestoSlug(String(t.positionName || ''), String(t.positionId || t.positionName || 'puesto'));
      const row = touch(oid, pid, String(t.positionName || pid), day, null);
      row[field] = r1(row[field] + hs);
      const codeU = code;
      if (codeU === 'FT' || t.isFrancoTrabajado) row.ft = r1(row.ft + hs);
    }
  };
  planOn(publishedTurnos, 'planPublished');
  planOn(draftTurnos, 'planDraft');

  for (const b of franja.buckets) {
    const oid = String(b.objectiveId || '').trim();
    if (!oid || !b.date?.startsWith(periodKey)) continue;
    const pid = puestoSlug(b.positionName, b.positionName);
    const row = touch(oid, pid, b.positionName || pid, b.date, null);
    row.covered = r1(row.covered + b.covered);
    row.uncovered = r1(row.uncovered + b.uncovered);
    row.objectiveName = b.objectiveName || row.objectiveName;
  }

  for (const r of demPub.rows) {
    if (r.ftHours) {
      const row = touch(r.id, 'ft', 'FT', ymd(year, month, 1), null);
      row.ft = r1(r.ftHours);
      row.objectiveName = r.name || row.objectiveName;
      row.clientName = r.client || row.clientName;
    }
    if (r.extHours) {
      const row = touch(r.id, 'ext', 'EXT', ymd(year, month, 1), null);
      row.ext = r1(r.extHours);
    }
    if (r.adelHours) {
      const row = touch(r.id, 'adv', 'ADV', ymd(year, month, 1), null);
      row.adv = r1(r.adelHours);
    }
  }

  const days = [...daysMap.values()].filter((d) =>
    d.slaActive || d.slaInactive || d.slaClosed || d.planPublished || d.planDraft
    || d.covered || d.uncovered || d.ft || d.ext || d.adv || d.novedadPaga,
  );

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
    m.ft = r1(r.ftHours);
    m.ext = r1(r.extHours);
    m.adv = r1(r.adelHours);
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

  let fichadaWeight = 0;
  const weights = new Map<string, number>();
  for (const t of activeTurnos) {
    const oid = String(t.objectiveId || '').trim();
    if (!oid) continue;
    const hs = Number(t.hours) || 0;
    if (!(hs > 0)) continue;
    weights.set(oid, (weights.get(oid) || 0) + hs);
    fichadaWeight += hs;
  }
  if (worked > 0 && fichadaWeight > 0) {
    for (const [oid, w] of weights) {
      const m = byObj.get(oid);
      if (!m) continue;
      m.worked = r1(worked * (w / fichadaWeight));
    }
    const assigned = [...byObj.values()].reduce((s, m) => s + m.worked, 0);
    const drift = r1(worked - assigned);
    const first = byObj.values().next().value as LedgerMonth | undefined;
    if (first && drift) first.worked = r1(first.worked + drift);
  }

  for (const d of days) {
    const m = byObj.get(d.objectiveId);
    if (!m) continue;
    m.covered = r1(m.covered + d.covered);
    m.uncovered = r1(m.uncovered + d.uncovered);
    m.novedadPaga = r1(m.novedadPaga + d.novedadPaga);
  }

  for (const m of byObj.values()) {
    if (!(m.worked > 0)) continue;
    const objDays = days.filter((d) => d.objectiveId === m.objectiveId);
    const weight = objDays.reduce((s, d) => s + d.planPublished + d.planDraft + d.covered, 0);
    if (!objDays.length || !(weight > 0)) continue;
    let acc = 0;
    objDays.forEach((d, i) => {
      const part = i === objDays.length - 1
        ? r1(m.worked - acc)
        : r1(m.worked * ((d.planPublished + d.planDraft + d.covered) / weight));
      d.worked = part;
      acc = r1(acc + part);
    });
  }

  const monthlyObjs = [...byObj.values()].filter((m) =>
    m.slaActive || m.slaInactive || m.slaClosed || m.planPublished || m.planDraft
    || m.worked || m.covered || m.uncovered || m.ft || m.ext || m.adv || m.novedadPaga,
  );

  const empresa = blankMetrics();
  for (const m of monthlyObjs) addMetrics(empresa, m);
  empresa.worked = worked;

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
