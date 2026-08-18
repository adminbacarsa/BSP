import { buildDemandaByObjective } from '@/lib/analisis/analisisDemanda';
import { isVacantShift, type AusenciasStats } from '@/lib/analisis/analisisQueries';
import { resolveCanonicalObjectiveId, type ObjectiveMeta } from '@/lib/crm/objectiveIdentity';
import {
  CRM_PLANNED_SHIFT_HOURS,
  getDurationHours,
  isCrmWorkingShiftCode,
  toDateSafe,
} from '@/lib/crm/plannedHours';
import { buildSlaExclusionContext } from '@/lib/crm/slaExclusionForPlanned';
import { pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
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
    const meta: ObjectiveMeta = { canonicalId, name, clientId: cid };
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
    const rs = toDateSafe(t.realStartTime);
    const re = toDateSafe(t.realEndTime);
    if (!rs || !re) continue;
    if (rs < periodStart || rs > periodEnd) continue;
    const code = String((t.code || t.type || '')).trim().toUpperCase();
    if (!isCrmWorkingShiftCode(code)) continue;
    let hrs = getDurationHours(rs, re);
    if (CRM_PLANNED_SHIFT_HOURS[code]) hrs = CRM_PLANNED_SHIFT_HOURS[code];
    if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = CRM_PLANNED_SHIFT_HOURS[code] || 8;
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
    const resultante = round1(plannedHours + extHours + adelHours + ftHours + opsHours);
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
      planned: round1(prev.planned + r.plannedHours),
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
      planned: round1(prev.planned + r.plannedHours),
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
