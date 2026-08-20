import { normalizeClientObjetivo } from '@/lib/crm/proformaEnrichment';
import { pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import { isSlaContractActive, type SlaPlanningRow } from '@/lib/slaPlanningMatch';

export type CrmSlaFootprint = {
  slaObjectives: number;
  slaPositions: number;
};

export type CrmCommercialStats = {
  clientsTotal: number;
  clientsActive: number;
  clientsWithSla: number;
  clientsSlaNoPlan: number;
  clientsUnderplanned: number;
  clientsNoExecution: number;
  clientsBurnAlert: number;
  catalogObjectives: number;
  slaObjectives: number | null;
  slaPositions: number | null;
  avgSlaPerClient: number;
};

function isClientActivo(status: unknown): boolean {
  const u = String(status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE';
}

function positionQuantity(pos: any): number {
  const q = Number(pos?.quantity ?? pos?.qty ?? 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function positionsOf(service: SlaPlanningRow): any[] {
  if (Array.isArray(service.positions)) return service.positions;
  return Object.values((service.positions as Record<string, unknown>) || {});
}

function dedupeActiveLatest(services: SlaPlanningRow[]): SlaPlanningRow[] {
  const byKey = new Map<string, SlaPlanningRow>();
  for (const s of services) {
    if (!isSlaContractActive(s.status)) continue;
    const oid = String(s.objectiveId ?? '').trim();
    const name = String(s.objectiveName ?? '').trim().toLowerCase();
    const key = `${String(s.clientId ?? '').trim()}::${oid || name || 'sin-obj'}`;
    const prev = byKey.get(key);
    const start = String(s.startDate ?? '');
    const prevStart = String(prev?.startDate ?? '');
    if (!prev || start.localeCompare(prevStart) > 0) byKey.set(key, s);
  }
  return [...byKey.values()];
}

export function slaFootprintFromServices(
  services: SlaPlanningRow[],
  rangeStart: Date | null,
  rangeEnd: Date | null,
): CrmSlaFootprint {
  const vigente = rangeStart && rangeEnd
    ? pickVigenteSlasForPeriod(services, rangeStart, rangeEnd)
    : dedupeActiveLatest(services);
  const objKeys = new Set<string>();
  let positions = 0;
  for (const s of vigente) {
    const oid = String(s.objectiveId ?? '').trim();
    const name = String(s.objectiveName ?? '').trim().toLowerCase();
    const key = oid || name;
    if (key) objKeys.add(key);
    for (const pos of positionsOf(s)) {
      positions += positionQuantity(pos);
    }
  }
  return { slaObjectives: objKeys.size, slaPositions: positions };
}

export function summarizeCrmCommercial(
  clients: Array<{ id: string; status?: unknown; objetivos?: unknown[] }>,
  metrics: Record<string, { sla?: number; planned?: number; real?: number; burnRate?: number }>,
  footprint: CrmSlaFootprint | null,
  totalSold: number,
): CrmCommercialStats {
  let clientsActive = 0;
  let clientsWithSla = 0;
  let clientsSlaNoPlan = 0;
  let clientsUnderplanned = 0;
  let clientsNoExecution = 0;
  let clientsBurnAlert = 0;
  let catalogObjectives = 0;

  for (const c of clients) {
    if (isClientActivo(c.status)) clientsActive += 1;
    const objs = Array.isArray(c.objetivos) ? c.objetivos : [];
    catalogObjectives += objs.filter((o) => {
      const n = normalizeClientObjetivo((o || {}) as { id?: string; objectiveId?: string; name?: string });
      return !!(n.id || n.name);
    }).length;

    const m = metrics[c.id] || {};
    const sla = Math.round(Number(m.sla) || 0);
    const planned = Math.round(Number(m.planned) || 0);
    const real = Math.round(Number(m.real) || 0);
    const burn = Number(m.burnRate) || 0;
    if (sla > 0) clientsWithSla += 1;
    if (sla > 0 && planned <= 0) clientsSlaNoPlan += 1;
    if (sla > 0 && planned > 0 && planned < sla) clientsUnderplanned += 1;
    if ((sla > 0 || planned > 0) && real <= 0) clientsNoExecution += 1;
    if (burn >= 90) clientsBurnAlert += 1;
  }

  return {
    clientsTotal: clients.length,
    clientsActive,
    clientsWithSla,
    clientsSlaNoPlan,
    clientsUnderplanned,
    clientsNoExecution,
    clientsBurnAlert,
    catalogObjectives,
    slaObjectives: footprint?.slaObjectives ?? null,
    slaPositions: footprint?.slaPositions ?? null,
    avgSlaPerClient: clientsWithSla > 0 ? Math.round(totalSold / clientsWithSla) : 0,
  };
}
