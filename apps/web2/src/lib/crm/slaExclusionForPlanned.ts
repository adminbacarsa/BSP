import { getDateKeyInTimezone, resolveTurnoScheduleDateKey, toDateSafe } from './crmDateUtils';
import { objectiveKeyForSla, pickVigenteSlasForPeriod } from './slaObjectiveHours';
import type { SlaPlanningRow } from '@/lib/slaPlanningMatch';
import type { ServicePosition } from '@/services/slaService';

export type ObjectiveExclusionRules = {
  contractExcluded: Set<string>;
  positions: Array<{
    name: string;
    excludedDates: Set<string>;
    excludedShiftDates: Map<string, Set<string>>;
  }>;
};

export type SlaExclusionContext = {
  byObjective: Map<string, ObjectiveExclusionRules>;
};

export type SlaExclusionSlotOptions = {
  /** Fecha de columna del cronograma (YYYY-MM-DD). Prioriza sobre startTime. */
  scheduleDateKey?: string;
  /** Puesto del legajo / celda (si el turno no trae positionName). */
  positionName?: string;
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

/** Coincidencia estricta de puesto SLA (sin substring: evita que «Sala principal» herede exclusiones de «Sala»). */
function positionNamesMatch(turnoPos: string, slaPos: string): boolean {
  const a = normPositionName(turnoPos);
  const b = normPositionName(slaPos);
  if (!a || !b) return false;
  return a === b;
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
      const shiftMap = new Map<string, Set<string>>();
      const rawShift = pos.excludedShiftDates;
      if (rawShift && typeof rawShift === 'object') {
        for (const [ds, codes] of Object.entries(rawShift)) {
          if (!Array.isArray(codes) || !codes.length) continue;
          shiftMap.set(ds, new Set(codes.map((c) => String(c || '').toUpperCase()).filter(Boolean)));
        }
      }
      if (!dates.length && shiftMap.size === 0) continue;
      positions.push({
        name,
        excludedDates: new Set(dates),
        excludedShiftDates: shiftMap,
      });
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

function resolveScheduleDateKey(
  t: { startTime?: unknown },
  opts?: SlaExclusionSlotOptions,
): string | null {
  const fromOpt = String(opts?.scheduleDateKey ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromOpt)) return fromOpt;
  const fromTurno = resolveTurnoScheduleDateKey(t as Record<string, unknown>);
  if (fromTurno) return fromTurno;
  const plannedStart = toDateSafe(t.startTime);
  if (!plannedStart) return null;
  return getDateKeyInTimezone(plannedStart);
}

/** true si el turno cae en día/puesto/banda excluido del SLA (no cuenta como planificado vs contrato). */
export function isTurnoOnSlaExcludedSlot(
  t: { startTime?: unknown; objectiveId?: unknown; objectiveName?: unknown; positionName?: unknown; code?: unknown },
  ctx: SlaExclusionContext | undefined,
  opts?: SlaExclusionSlotOptions,
): boolean {
  if (!ctx) return false;
  const rules = resolveObjectiveRules(t, ctx);
  if (!rules) return false;

  const dateKey = resolveScheduleDateKey(t, opts);
  if (!dateKey) return false;

  if (rules.contractExcluded.has(dateKey)) return true;

  const posName = String(opts?.positionName ?? t.positionName ?? '').trim();
  if (!posName) return false;
  const code = String(t.code ?? '').toUpperCase();
  for (const pos of rules.positions) {
    if (!positionNamesMatch(posName, pos.name)) continue;
    if (pos.excludedDates.has(dateKey)) return true;
    if (code && pos.excludedShiftDates.get(dateKey)?.has(code)) return true;
  }
  return false;
}
