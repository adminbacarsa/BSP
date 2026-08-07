import { getDateKeyInTimezone, toDateSafe } from './crmDateUtils';
import { objectiveKeyForSla, pickVigenteSlasForPeriod } from './slaObjectiveHours';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import type { ServicePosition } from '@/services/slaService';

export type ObjectiveExclusionRules = {
  contractExcluded: Set<string>;
  positions: Array<{ name: string; excludedDates: Set<string> }>;
};

export type SlaExclusionContext = {
  byObjective: Map<string, ObjectiveExclusionRules>;
};

function normKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normPositionName(value: unknown): string {
  return normKey(value).replace(/^puesto\s+/, '');
}

function positionNamesMatch(turnoPos: string, slaPos: string): boolean {
  const a = normPositionName(turnoPos);
  const b = normPositionName(slaPos);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function registerObjectiveRules(
  map: Map<string, ObjectiveExclusionRules>,
  keys: string[],
  rules: ObjectiveExclusionRules,
): void {
  for (const key of keys) {
    const k = String(key || '').trim();
    if (!k) continue;
    map.set(k, rules);
    map.set(normKey(k), rules);
  }
}

/** Reglas de exclusión SLA (contrato + puesto) por objetivo — vigente en el rango. */
export function buildSlaExclusionContext(
  services: SlaPlanningRow[],
  rangeStart: Date,
  rangeEnd: Date,
): SlaExclusionContext {
  const byObjective = new Map<string, ObjectiveExclusionRules>();
  const vigente = pickVigenteSlasForPeriod(services, rangeStart, rangeEnd);

  for (const srv of vigente) {
    const contractExcluded = new Set<string>(
      Array.isArray(srv.excludedDates) ? (srv.excludedDates as string[]) : [],
    );
    const positions: ObjectiveExclusionRules['positions'] = [];
    const rawPositions = Array.isArray(srv.positions)
      ? srv.positions
      : Object.values((srv.positions as Record<string, unknown>) || {});

    for (const raw of rawPositions) {
      const pos = raw as ServicePosition & { positionName?: string };
      const name = String(pos.name ?? pos.positionName ?? '').trim();
      if (!name) continue;
      const dates = Array.isArray(pos.excludedDates) ? pos.excludedDates : [];
      if (!dates.length) continue;
      positions.push({ name, excludedDates: new Set(dates) });
    }

    const rules: ObjectiveExclusionRules = { contractExcluded, positions };
    registerObjectiveRules(byObjective, [
      String(srv.objectiveId ?? '').trim(),
      String(srv.objectiveName ?? '').trim(),
      objectiveKeyForSla(srv),
    ], rules);
  }

  return { byObjective };
}

function resolveObjectiveRules(
  t: { objectiveId?: unknown; objectiveName?: unknown },
  ctx: SlaExclusionContext,
): ObjectiveExclusionRules | undefined {
  const candidates = [
    String(t.objectiveId ?? '').trim(),
    String(t.objectiveName ?? '').trim(),
    normKey(t.objectiveId),
    normKey(t.objectiveName),
  ].filter(Boolean);

  for (const key of candidates) {
    const rules = ctx.byObjective.get(key);
    if (rules) return rules;
  }
  return undefined;
}

/** true si el turno cae en día/puesto excluido del SLA (no cuenta como planificado vs contrato). */
export function isTurnoOnSlaExcludedSlot(
  t: { startTime?: unknown; objectiveId?: unknown; objectiveName?: unknown; positionName?: unknown },
  ctx: SlaExclusionContext | undefined,
): boolean {
  if (!ctx) return false;
  const rules = resolveObjectiveRules(t, ctx);
  if (!rules) return false;

  const plannedStart = toDateSafe(t.startTime);
  if (!plannedStart) return false;
  const dateKey = getDateKeyInTimezone(plannedStart);

  if (rules.contractExcluded.has(dateKey)) return true;

  const posName = String(t.positionName ?? '').trim();
  if (!posName) return false;
  for (const pos of rules.positions) {
    if (positionNamesMatch(posName, pos.name) && pos.excludedDates.has(dateKey)) return true;
  }
  return false;
}
