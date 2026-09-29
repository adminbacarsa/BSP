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
export function objectiveMonthSlaPresence(input: {
  slas: ProformaSlaRow[];
  year: number;
  monthIndex0: number;
  hasPublishedPlan: boolean;
  clientStatus?: unknown;
}): 'active' | 'withoutPlan' | 'closed' | 'none' {
  let sawWithoutPlan = false;
  let sawClosed = false;
  for (const srv of input.slas) {
    if (!slaCoversCalendarMonth(srv.startDate, srv.endDate, input.year, input.monthIndex0)) continue;
    const bucket = classifySlaBucket({
      closed: srv.closed === true,
      contractActive: contractIsActive(srv.status),
      clientActive: clientIsActive(input.clientStatus),
      hasPublishedPlan: input.hasPublishedPlan,
    });
    if (bucket === 'active') return 'active';
    if (bucket === 'withoutPlan') sawWithoutPlan = true;
    else if (bucket === 'closed') sawClosed = true;
  }
  if (sawWithoutPlan) return 'withoutPlan';
  if (sawClosed) return 'closed';
  return 'none';
}
