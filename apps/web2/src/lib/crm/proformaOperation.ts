import { slaCoversCalendarMonth } from '@/lib/firestoreDates';
import {
  classifySlaBucket,
  inOperationObjectiveIds,
  splitHoursByOperation,
  type SlaBucket,
} from '../../../../../scripts/hours-ledger/slaPolicy';

export { splitHoursByOperation };

export type ProformaSlaRow = {
  objectiveId?: unknown;
  clientId?: unknown;
  status?: unknown;
  closed?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

function clientIsActive(status: unknown): boolean {
  const u = String(status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE' || u === '';
}

function contractIsActive(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  if (!st) return true;
  return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}

/**
 * Objetivos que la prefactura puede facturar en el mes.
 * Misma regla que el libro: classifySlaBucket activo o cerrado.
 */
export function buildInOperationObjectiveIds(input: {
  slas: ProformaSlaRow[];
  year: number;
  /** 0 = enero, igual que `slaCoversCalendarMonth`. */
  monthIndex0: number;
  publishedObjectiveIds: ReadonlySet<string>;
  clientStatusById?: ReadonlyMap<string, unknown>;
}): Set<string> {
  const buckets = new Map<string, SlaBucket[]>();
  for (const srv of input.slas) {
    const oid = String(srv.objectiveId ?? '').trim();
    if (!oid) continue;
    if (!slaCoversCalendarMonth(srv.startDate, srv.endDate, input.year, input.monthIndex0)) continue;
    const clientId = String(srv.clientId ?? '').trim();
    const known = clientId && input.clientStatusById?.has(clientId)
      ? input.clientStatusById.get(clientId)
      : undefined;
    const bucket = classifySlaBucket({
      closed: srv.closed === true,
      contractActive: contractIsActive(srv.status),
      clientActive: clientIsActive(known),
      hasPublishedPlan: input.publishedObjectiveIds.has(oid),
    });
    const list = buckets.get(oid) || [];
    list.push(bucket);
    buckets.set(oid, list);
  }
  return inOperationObjectiveIds(buckets);
}

/**
 * Presencia del objetivo en el mes, con la misma regla que el libro (`classifySlaBucket`).
 * active = en operación; withoutPlan = contrato activo sin cronograma publicado;
 * closed = cerrado del mes; none = sin contrato que cubra el mes.
 */
function scanObjectiveMonth(input: {
  slas: ProformaSlaRow[];
  year: number;
  monthIndex0: number;
  hasPublishedPlan: boolean;
  clientStatus?: unknown;
}): { active: boolean; withoutPlan: boolean; closed: boolean } {
  let active = false;
  let withoutPlan = false;
  let closed = false;
  for (const srv of input.slas) {
    if (!slaCoversCalendarMonth(srv.startDate, srv.endDate, input.year, input.monthIndex0)) continue;
    const bucket = classifySlaBucket({
      closed: srv.closed === true,
      contractActive: contractIsActive(srv.status),
      clientActive: clientIsActive(input.clientStatus),
      hasPublishedPlan: input.hasPublishedPlan,
    });
    if (bucket === 'active') active = true;
    else if (bucket === 'withoutPlan') withoutPlan = true;
    else if (bucket === 'closed') closed = true;
  }
  return { active, withoutPlan, closed };
}

export function objectiveMonthSlaPresence(input: {
  slas: ProformaSlaRow[];
  year: number;
  monthIndex0: number;
  hasPublishedPlan: boolean;
  clientStatus?: unknown;
}): 'active' | 'withoutPlan' | 'closed' | 'none' {
  const flags = scanObjectiveMonth(input);
  if (flags.active) return 'active';
  if (flags.withoutPlan) return 'withoutPlan';
  if (flags.closed) return 'closed';
  return 'none';
}

/** Hay al menos un contrato cerrado que cubre el mes (classifySlaBucket), aunque el objetivo también esté en operación. */
export function objectiveMonthHasClosedSla(input: {
  slas: ProformaSlaRow[];
  year: number;
  monthIndex0: number;
  hasPublishedPlan: boolean;
  clientStatus?: unknown;
}): boolean {
  return scanObjectiveMonth(input).closed;
}
