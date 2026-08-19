import { buildDemandaByObjective } from '@/lib/analisis/analisisDemanda';
import { isVacantShift, type AusenciasStats } from '@/lib/analisis/analisisQueries';
import { resolveCanonicalObjectiveId, type ObjectiveMeta } from '@/lib/crm/objectiveIdentity';
import {
  fichadaAnchorDate,
  fichadaHoursForShift,
  isShiftFichado,
} from '@/lib/crm/fichadaHours';
import { buildSlaExclusionContext } from '@/lib/crm/slaExclusionForPlanned';
import { pickVigenteSlasForPeriod, slaHoursForServiceInRange } from '@/lib/crm/slaObjectiveHours';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import { applyLiveSlaHoursToBalanceRows } from './overlayLiveSla';
import {
  type HoursBalanceRow,
  type HoursBalanceSource,
  hoursBalancePeriodKey,
  round1,
} from './types';

export function buildObjectiveAliasesFromSla(services: SlaPlanningRow[]): Record<string, ObjectiveMeta> {
  const aliases: Record<string, ObjectiveMeta> = {};
  const register = (meta: ObjectiveMeta, key: string) => {
    const k = String(key || '').trim();
    if (k) aliases[k] = meta;
  };
  for (const srv of services) {
    const cid = String(srv.clientId ?? '').trim();
    const oid = String(srv.objectiveId ?? '').trim();
    const name = String(srv.objectiveName ?? oid).trim();
    const canonicalId = oid || name;
    if (!canonicalId) continue;
    const meta: ObjectiveMeta = { canonicalId, name, clientId: cid, clientName: String(srv.clientName ?? '').trim() };
    register(meta, canonicalId);
    if (oid) register(meta, oid);
    if (name) register(meta, name);
    if (cid && name) register(meta, `${cid}_${name}`);
  }
  return aliases;
}

function realHoursByObjective(
  turnos: any[],
  aliases: Record<string, ObjectiveMeta>,
  periodStart: Date,
  periodEnd: Date,
): Map<string, number> {
  const acc = new Map<string, number>();
  for (const t of turnos) {
    if (isVacantShift(t)) continue;
    if (String(t.type || '').toUpperCase() === 'NOVEDAD') continue;
    const status = String(t.status || '').toLowerCase();
    if (status.includes('cancel') || status.includes('delet')) continue;
    if (!isShiftFichado(t)) continue;
    const when = fichadaAnchorDate(t);
    if (!when || when < periodStart || when > periodEnd) continue;
    const hrs = fichadaHoursForShift(t);
    if (!(hrs > 0)) continue;
    const oid =
      resolveCanonicalObjectiveId(t, aliases) ||
      String(t.objectiveId ?? '').trim() ||
      'SIN_OBJETIVO';
    acc.set(oid, (acc.get(oid) || 0) + hrs);
  }
  return acc;
}

export function buildHoursBalanceMonth(opts: {
  empresaId: string;
  year: number;
  month: number;
  services: SlaPlanningRow[];
  turnos: any[];
  ausenciasStats?: AusenciasStats | null;
  rebuiltFrom?: HoursBalanceSource;
}): HoursBalanceRow[] {
  const { empresaId, year, month, services, turnos, ausenciasStats = null, rebuiltFrom = 'manual' } = opts;
  const periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const aliases = buildObjectiveAliasesFromSla(services);
  const vigente = pickVigenteSlasForPeriod(services, periodStart, periodEnd);
  const slaExclusionCtx = buildSlaExclusionContext(services, periodStart, periodEnd);
  const demanda = buildDemandaByObjective({
    turnos,
    ausenciasStats,
    vigenteServices: vigente,
    periodStart,
    periodEnd,
    objectiveAliases: aliases,
    slaExclusionCtx,
  });
  const realByObj = realHoursByObjective(turnos, aliases, periodStart, periodEnd);
  const periodKey = hoursBalancePeriodKey(year, month);
  const emp = String(empresaId || '').trim();

  const clientByObj = new Map<string, { clientId: string; clientName: string }>();
  vigente.forEach((srv) => {
    const oid = resolveCanonicalObjectiveId(srv, aliases) || String(srv.objectiveId ?? '').trim();
    if (!oid) return;
    clientByObj.set(oid, {
      clientId: String(srv.clientId ?? aliases[oid]?.clientId ?? '').trim(),
      clientName: String(srv.clientName ?? '').trim(),
    });
  });

  const seen = new Set<string>();
  const rows: HoursBalanceRow[] = [];

  const push = (id: string, name: string, clientName: string, extra: Partial<HoursBalanceRow>) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const meta = clientByObj.get(id);
    const slaHours = round1(extra.slaHours || 0);
    const plannedHours = round1(extra.plannedHours || 0);
    const realHours = round1(extra.realHours || 0);
    const extHours = round1(extra.extHours || 0);
    const adelHours = round1(extra.adelHours || 0);
    const ftHours = round1(extra.ftHours || 0);
    const opsHours = round1(extra.opsHours || 0);
    const vacantHours = round1(extra.vacantHours || 0);
    const absenceHours = round1(extra.absenceHours || 0);
    const resultante = round1(plannedHours + extHours + adelHours + opsHours);
    rows.push({
      empresaId: emp,
      objectiveId: id,
      objectiveName: name,
      clientId: meta?.clientId || extra.clientId || '',
      clientName: meta?.clientName || clientName || '',
      year,
      month,
      periodKey,
      slaHours,
      plannedHours,
      vacantHours,
      realHours,
      ftHours,
      extHours,
      adelHours,
      opsHours,
      absenceHours,
      resultante,
      saldoPlan: round1(slaHours - plannedHours),
      saldoReal: round1(slaHours - realHours),
      rebuiltFrom,
    });
  };

  for (const r of demanda.rows) {
    push(r.id, r.name, r.client, {
      slaHours: r.slaHours,
      plannedHours: r.planHours,
      vacantHours: r.vacantHours,
      realHours: realByObj.get(r.id) || 0,
      ftHours: r.ftHours,
      extHours: r.extHours,
      adelHours: r.adelHours,
      opsHours: r.opsHours,
      absenceHours: r.absenceHours,
    });
  }

  realByObj.forEach((hs, id) => {
    if (seen.has(id)) return;
    const alias = aliases[id];
    push(id, alias?.name || id, '', { realHours: hs, clientId: alias?.clientId || '' });
  });

  return rows.filter((r) =>
    r.slaHours > 0 || r.plannedHours > 0 || r.realHours > 0 || r.resultante > 0 || r.vacantHours > 0,
  );
}

export function sumBalancesByClient(rows: HoursBalanceRow[]): Record<string, {
  sla: number;
  planned: number;
  real: number;
  resultante: number;
}> {
  const acc: Record<string, { sla: number; planned: number; real: number; resultante: number }> = {};
  for (const r of rows) {
    const cid = String(r.clientId || '').trim() || '_sin_cliente';
    const prev = acc[cid] || { sla: 0, planned: 0, real: 0, resultante: 0 };
    acc[cid] = {
      sla: round1(prev.sla + r.slaHours),
      planned: round1(prev.planned + r.plannedHours + r.extHours + r.adelHours),
      real: round1(prev.real + r.realHours),
      resultante: round1(prev.resultante + r.resultante),
    };
  }
  return acc;
}

export function sumBalancesByPeriodKey(rows: HoursBalanceRow[]): Record<string, {
  sla: number;
  planned: number;
  real: number;
}> {
  const acc: Record<string, { sla: number; planned: number; real: number }> = {};
  for (const r of rows) {
    const prev = acc[r.periodKey] || { sla: 0, planned: 0, real: 0 };
    acc[r.periodKey] = {
      sla: round1(prev.sla + r.slaHours),
      planned: round1(prev.planned + r.plannedHours + r.extHours + r.adelHours),
      real: round1(prev.real + r.realHours),
    };
  }
  return acc;
}

export function balancesCoverPeriodKeys(rows: HoursBalanceRow[], periodKeys: string[]): boolean {
  if (periodKeys.length === 0) return false;
  const keys = new Set(rows.map((r) => r.periodKey));
  return periodKeys.every((k) => keys.has(k));
}

/** True si cada objetivo tiene fila en todos los periodKeys (extracto usable sin fallback a turnos). */
export function balancesCoverObjectives(
  rows: HoursBalanceRow[],
  periodKeys: string[],
  objectiveIds: string[],
): boolean {
  if (periodKeys.length === 0) return false;
  const ids = [...new Set(objectiveIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return false;
  const byPeriod = new Map<string, Set<string>>();
  for (const r of rows) {
    const oid = String(r.objectiveId || '').trim();
    if (!oid) continue;
    let set = byPeriod.get(r.periodKey);
    if (!set) {
      set = new Set();
      byPeriod.set(r.periodKey, set);
    }
    set.add(oid);
  }
  return periodKeys.every((k) => {
    const have = byPeriod.get(k);
    return !!have && ids.every((id) => have.has(id));
  });
}

/** SLA vivo por mes del extracto (evita 84.193 viejo vs 84.098 del contrato actual). */
export function overlayLiveSlaOnBalanceRows(
  rows: HoursBalanceRow[],
  services: SlaPlanningRow[],
): HoursBalanceRow[] {
  if (!rows.length || !services.length) return rows;
  const aliases = buildObjectiveAliasesFromSla(services);
  const groups = new Map<string, HoursBalanceRow[]>();
  for (const r of rows) {
    const k = r.periodKey || hoursBalancePeriodKey(r.year, r.month);
    const arr = groups.get(k) || [];
    arr.push(r);
    groups.set(k, arr);
  }
  const out: HoursBalanceRow[] = [];
  for (const subset of groups.values()) {
    const year = subset[0]?.year;
    const month = subset[0]?.month;
    if (!year || !month) {
      out.push(...subset);
      continue;
    }
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const vigente = pickVigenteSlasForPeriod(services, start, end);
    const live: Record<string, number> = {};
    const meta: Record<string, { clientId?: string; clientName?: string; objectiveName?: string }> = {};
    for (const srv of vigente) {
      const oid = resolveCanonicalObjectiveId(srv, aliases) || String(srv.objectiveId ?? '').trim();
      if (!oid) continue;
      const hs = slaHoursForServiceInRange(srv, start, end);
      if (!(hs > 0)) continue;
      live[oid] = round1((live[oid] || 0) + hs);
      meta[oid] = {
        clientId: String(srv.clientId ?? '').trim(),
        clientName: String(srv.clientName ?? '').trim(),
        objectiveName: String(srv.objectiveName ?? oid).trim(),
      };
    }
    out.push(...applyLiveSlaHoursToBalanceRows(subset, live, meta));
  }
  return out;
}
