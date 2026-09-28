import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView, empresaCollectionQuery, getClientIdAliases, tenantEmpresaIdsMatch } from '@/lib/multiempresa';
import { getDateKeyInTimezone, resolveTurnoScheduleDateKey } from '@/lib/crm/crmDateUtils';
import { isFirestoreIndexError } from '@/lib/crm/firestoreIndexError';
import {
  clientRowMatchesClient,
  normalizeClientName,
  objectiveIdsForClient,
  type ClientRef,
} from '@/lib/crm/clientRowMatch';

// La coincidencia pura (sin Firebase) vive en clientRowMatch.ts; se re-exporta para los imports existentes.
export { clientRowMatchesClient, type ClientRef } from '@/lib/crm/clientRowMatch';

/**
 * Ids reales para `objectiveId in`. El nombre del objetivo no es un id:
 * meterlo en la consulta trae documentos ajenos o lecturas vacías.
 */
export function objectiveIdsForTurnoQuery(clients: ClientRef[]): string[] {
  const ids = new Set<string>();
  for (const client of clients) {
    for (const o of client.objetivos || []) {
      const id = String(o.id ?? '').trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export type TurnoQueryOpts = {
  empresaId?: string;
  scopeEmpresa?: boolean;
  migracionCompleta?: boolean;
};

function turnoBelongsToEmpresa(
  data: { empresaId?: unknown },
  opts?: TurnoQueryOpts,
): boolean {
  const empresaId = String(opts?.empresaId ?? '').trim();
  if (!empresaId) return false;
  return belongsToEmpresaView(data, empresaId, opts?.migracionCompleta !== false);
}

export { isFirestoreIndexError } from '@/lib/crm/firestoreIndexError';

async function fetchTurnosByObjectiveIds(
  objectiveIds: string[],
  addIfInRange: (id: string, data: Record<string, unknown>) => void,
  padStart: Date,
  padEnd: Date,
  empresaId: string,
): Promise<void> {
  const ids = [...new Set(objectiveIds.map((x) => String(x).trim()).filter(Boolean))];
  const empresa = String(empresaId || '').trim();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  await Promise.all(chunks.map(async (chunk) => {
    const start = Timestamp.fromDate(padStart);
    const end = Timestamp.fromDate(padEnd);
    try {
      const constraints = [
        ...(empresa ? [where('empresaId', '==', empresa)] : []),
        where('objectiveId', 'in', chunk),
        where('startTime', '>=', start),
        where('startTime', '<=', end),
      ];
      const snap = await getDocs(query(collection(db, 'turnos'), ...constraints));
      snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
    } catch (error) {
      if (!empresa || !isFirestoreIndexError(error)) throw error;
      const snap = await getDocs(query(
        collection(db, 'turnos'),
        where('objectiveId', 'in', chunk),
        where('startTime', '>=', start),
        where('startTime', '<=', end),
      ));
      snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
    }
  }));
}

/** RFZ/TURA guardan startTime ISO + fecha YYYY-MM-DD — no entran en query por Timestamp. */
async function fetchRefuerzoTurnosByObjectiveIds(
  objectiveIds: string[],
  addIfInRange: (id: string, data: Record<string, unknown>) => void,
  start: Date,
  end: Date,
): Promise<void> {
  const ids = [...new Set(objectiveIds.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const rangeStartKey = getDateKeyInTimezone(start);
  const rangeEndKey = getDateKeyInTimezone(end);
  for (const code of ['TURA', 'RFZ'] as const) {
    await Promise.all(ids.map(async (oid) => {
      try {
        const snap = await getDocs(query(
          collection(db, 'turnos'),
          where('objectiveId', '==', oid),
          where('code', '==', code),
          where('fecha', '>=', rangeStartKey),
          where('fecha', '<=', rangeEndKey),
        ));
        snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
      } catch {
        /* índice compuesto opcional */
      }
    }));
  }
}

export function resolveCanonicalClientIdFromList(
  rowClientId: unknown,
  clients: ClientRef[],
): string | null {
  const cid = String(rowClientId ?? '').trim();
  if (!cid) return null;
  for (const c of clients) {
    if (c.id === cid) return c.id;
    if (getClientIdAliases(c.id).includes(cid)) return c.id;
  }
  return null;
}

/**
 * Misma regla que `loadClientSlaForClient`: primero por `clientId` (aliases);
 * si hay al menos uno, solo esos. Si no, match por objetivo/nombre del cliente.
 */
export function selectSlaRowsForClient(slaRows: any[], client: ClientRef): any[] {
  const aliases = new Set(getClientIdAliases(client.id));
  const byId = new Map<string, any>();

  for (const s of slaRows) {
    const rowCid = String(s.clientId ?? '').trim();
    if (rowCid && aliases.has(rowCid)) {
      byId.set(s.id, s);
    }
  }

  if (byId.size > 0) {
    return [...byId.values()];
  }

  for (const s of slaRows) {
    if (!clientRowMatchesClient(s, client)) continue;
    byId.set(s.id, s);
  }

  return [...byId.values()];
}

/** Una lectura de servicios_sla + misma lógica de match que loadClientSlaForClient (sin N×Firestore). */
export function indexSlaRowsByClients(
  slaRows: any[],
  clients: ClientRef[],
): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const c of clients) {
    map.set(c.id, selectSlaRowsForClient(slaRows, c));
  }
  return map;
}

export function collectClientIdAliases(clients: ClientRef[]): string[] {
  const aliasSet = new Set<string>();
  for (const c of clients) {
    for (const a of getClientIdAliases(c.id)) aliasSet.add(a);
  }
  return [...aliasSet];
}

async function fetchRowsByClientIdInBatches(
  collectionName: string,
  aliases: string[],
  onRow: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  if (aliases.length === 0) return;
  for (let i = 0; i < aliases.length; i += 10) {
    const chunk = aliases.slice(i, i + 10);
    const snap = await getDocs(query(collection(db, collectionName), where('clientId', 'in', chunk)));
    snap.docs.forEach((d) => onRow(d.id, d.data() as Record<string, unknown>));
  }
}

/**
 * SLA del dashboard: consulta por `clientId` (aliases) en lotes — evita leer toda la colección.
 * Respaldo por empresa solo para clientes sin ningún SLA por alias.
 */
export async function fetchSlaRowsForCrmDashboard(
  clients: ClientRef[],
  opts: { empresaId: string; scopeEmpresa: boolean; migracionCompleta: boolean },
): Promise<any[]> {
  const { empresaId, scopeEmpresa, migracionCompleta } = opts;
  const byId = new Map<string, any>();
  const tenantAliasSet = new Set(collectClientIdAliases(clients));

  const ingest = (id: string, data: Record<string, unknown>) => {
    const row = { id, ...data };
    if (scopeEmpresa) {
      const cid = String(row.clientId ?? '').trim();
      const linkedToTenant = !!cid && tenantAliasSet.has(cid);
      const matchedByClient = clients.some((c) => clientRowMatchesClient(row, c));
      if (!linkedToTenant && !matchedByClient && !belongsToEmpresaView(row, empresaId, migracionCompleta)) {
        return;
      }
    }
    byId.set(id, row);
  };

  if (clients.length > 0 && tenantAliasSet.size > 0) {
    await fetchRowsByClientIdInBatches('servicios_sla', [...tenantAliasSet], ingest);

    const indexed = indexSlaRowsByClients([...byId.values()], clients);
    const clientsWithoutSla = clients.filter((c) => (indexed.get(c.id)?.length || 0) === 0);
    if (clientsWithoutSla.length > 0) {
      const snap = await getDocs(
        empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>,
      );
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!clientsWithoutSla.some((c) => clientRowMatchesClient(data, c))) return;
        ingest(d.id, data);
      });
    }

    return [...byId.values()];
  }

  const baseSnap = await getDocs(
    empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>,
  );
  baseSnap.docs.forEach((d) => ingest(d.id, d.data() as Record<string, unknown>));
  return [...byId.values()];
}

/** Contratos del dashboard: solo clientes visibles (por `clientId`), no toda la colección. */
export async function fetchContractsForCrmDashboard(
  clients: ClientRef[],
  opts: { empresaId: string; scopeEmpresa: boolean },
): Promise<any[]> {
  const { empresaId, scopeEmpresa } = opts;
  const tenantClientIds = new Set(clients.map((c) => c.id));
  const byId = new Map<string, any>();

  const ingest = (id: string, data: Record<string, unknown>) => {
    const row = { id, ...data };
    const cid = String(row.clientId ?? '').trim();
    if (!cid) return;
    const canonical = resolveCanonicalClientIdFromList(cid, clients);
    if (!canonical || !tenantClientIds.has(canonical)) return;
    if (scopeEmpresa) {
      const docEmp = String(row.empresaId ?? '').trim();
      if (docEmp && !tenantEmpresaIdsMatch(docEmp, empresaId)) return;
    }
    byId.set(id, row);
  };

  const aliases = collectClientIdAliases(clients);
  if (aliases.length === 0) return [];

  await fetchRowsByClientIdInBatches('contracts', aliases, ingest);
  return [...byId.values()];
}

async function queryByClientIdAliases<T extends Record<string, unknown>>(
  collectionName: string,
  client: ClientRef,
  mapDoc: (id: string, data: Record<string, unknown>) => T,
): Promise<T[]> {
  const byId = new Map<string, T>();
  const aliases = getClientIdAliases(client.id);
  for (const cid of aliases) {
    const snap = await getDocs(query(collection(db, collectionName), where('clientId', '==', cid)));
    snap.docs.forEach((d) => {
      const row = mapDoc(d.id, d.data() as Record<string, unknown>);
      byId.set(d.id, row);
    });
  }
  return [...byId.values()];
}

export async function loadClientSlaForClient(
  client: ClientRef,
  opts?: { empresaId?: string; scopeEmpresa?: boolean },
): Promise<any[]> {
  const rows = await queryByClientIdAliases('servicios_sla', client, (id, data) => ({ id, ...data }));

  if (rows.length > 0) return rows;

  const empresaId = String(opts?.empresaId ?? '').trim();
  const scopeEmpresa = opts?.scopeEmpresa === true && !!empresaId;
  const snap = await getDocs(
    empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>,
  );

  const allRows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  return selectSlaRowsForClient(allRows, client);
}

function toDateSafe(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: () => Date })?.toDate === 'function') return (val as { toDate: () => Date }).toDate();
  if (typeof (val as { seconds?: number })?.seconds === 'number') return new Date((val as { seconds: number }).seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

type PeriodTurnoCacheEntry = {
  empresaId: string;
  startMs: number;
  endMs: number;
  objectiveKey: string;
  rows: any[];
  at: number;
};

const periodTurnoCache: PeriodTurnoCacheEntry[] = [];
const periodTurnoInflight = new Map<string, Promise<any[]>>();
const PERIOD_TURNO_CACHE_MS = 90_000;

function periodCacheKey(empresaId: string, start: Date, end: Date, objectiveIds: string[]): string {
  return `${empresaId}|${start.getTime()}|${end.getTime()}|${[...objectiveIds].sort().join(',')}`;
}

function takeCachedPeriodTurnos(
  empresaId: string,
  start: Date,
  end: Date,
  objectiveIds: string[],
): any[] | null {
  const now = Date.now();
  const wanted = new Set(objectiveIds);
  for (let i = periodTurnoCache.length - 1; i >= 0; i -= 1) {
    const entry = periodTurnoCache[i];
    if (now - entry.at > PERIOD_TURNO_CACHE_MS) {
      periodTurnoCache.splice(i, 1);
      continue;
    }
    if (entry.empresaId !== empresaId) continue;
    if (entry.startMs > start.getTime() || entry.endMs < end.getTime()) continue;
    const have = new Set(entry.objectiveKey.split(',').filter(Boolean));
    if (wanted.size === 0) {
      if (entry.objectiveKey !== '') continue;
    } else if (![...wanted].every((id) => have.has(id))) {
      continue;
    }
    const rangeStartKey = getDateKeyInTimezone(start);
    const rangeEndKey = getDateKeyInTimezone(end);
    return entry.rows.filter((row) => {
      if (wanted.size > 0 && !wanted.has(String(row.objectiveId ?? '').trim())) return false;
      const st = toDateSafe(row.startTime);
      const scheduleKey = resolveTurnoScheduleDateKey(row) || (st ? getDateKeyInTimezone(st) : null);
      const inRangeByStart = !!st && st >= start && st <= end;
      const inRangeBySchedule = !!scheduleKey && scheduleKey >= rangeStartKey && scheduleKey <= rangeEndKey;
      return inRangeByStart || inRangeBySchedule;
    });
  }
  return null;
}

/**
 * Una sola estrategia de lectura para KPIs y prefactura:
 * objectiveId real (lotes de 10) + startTime del período, siempre filtrado por empresa.
 * Sin nombres en el `in`, sin segunda pasada por clientId y sin barrido de toda la empresa.
 * TURA/RFZ con startTime texto se suman por `fecha` (no entran en la query por Timestamp).
 */
export async function loadPeriodTurnosForClients(
  clients: ClientRef[],
  start: Date,
  end: Date,
  opts?: TurnoQueryOpts,
): Promise<any[]> {
  const empresaId = String(opts?.empresaId ?? '').trim();
  const objectiveIds = objectiveIdsForTurnoQuery(clients);
  const key = periodCacheKey(empresaId, start, end, objectiveIds);
  const cached = takeCachedPeriodTurnos(empresaId, start, end, objectiveIds);
  if (cached) return cached;

  const inflight = periodTurnoInflight.get(key);
  if (inflight) return inflight;

  const job = loadPeriodTurnosUncached(clients, start, end, opts, objectiveIds).then((rows) => {
    periodTurnoCache.push({
      empresaId,
      startMs: start.getTime(),
      endMs: end.getTime(),
      objectiveKey: [...objectiveIds].sort().join(','),
      rows,
      at: Date.now(),
    });
    return rows;
  }).finally(() => {
    periodTurnoInflight.delete(key);
  });
  periodTurnoInflight.set(key, job);
  return job;
}

async function loadPeriodTurnosUncached(
  clients: ClientRef[],
  start: Date,
  end: Date,
  opts: TurnoQueryOpts | undefined,
  objectiveIds: string[],
): Promise<any[]> {
  const byId = new Map<string, any>();
  const rangeStartKey = getDateKeyInTimezone(start);
  const rangeEndKey = getDateKeyInTimezone(end);
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const addIfInRange = (id: string, data: Record<string, unknown>) => {
    if (!turnoBelongsToEmpresa(data, opts)) return;
    const st = toDateSafe(data.startTime);
    const scheduleKey =
      resolveTurnoScheduleDateKey(data) || (st ? getDateKeyInTimezone(st) : null);
    const inRangeByStart = !!st && st >= start && st <= end;
    const inRangeBySchedule =
      !!scheduleKey && scheduleKey >= rangeStartKey && scheduleKey <= rangeEndKey;
    if (!inRangeByStart && !inRangeBySchedule) return;
    const matched = clients.find((c) => clientRowMatchesClient(data, c));
    if (!matched) return;
    const rowCid = String(data.clientId ?? '').trim();
    const canonical = rowCid && clientById.has(rowCid) ? rowCid : matched.id;
    byId.set(id, { id, ...data, clientId: rowCid || canonical });
  };

  // Pad para nocturnos. La query es por startTime (ops_cov no tiene scheduleDate).
  const padStart = new Date(start);
  const padEnd = new Date(end);
  padStart.setDate(padStart.getDate() - 2);
  padEnd.setDate(padEnd.getDate() + 2);
  padEnd.setHours(23, 59, 59, 999);

  if (objectiveIds.length > 0) {
    await fetchTurnosByObjectiveIds(
      objectiveIds,
      addIfInRange,
      padStart,
      padEnd,
      String(opts?.empresaId ?? '').trim(),
    );
    await fetchRefuerzoTurnosByObjectiveIds(objectiveIds, addIfInRange, start, end);
  } else {
    const aliases = collectClientIdAliases(clients);
    for (let i = 0; i < aliases.length; i += 10) {
      const chunk = aliases.slice(i, i + 10);
      const snap = await getDocs(query(
        collection(db, 'turnos'),
        where('clientId', 'in', chunk),
        where('startTime', '>=', Timestamp.fromDate(padStart)),
        where('startTime', '<=', Timestamp.fromDate(padEnd)),
      ));
      snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
    }
  }

  return [...byId.values()];
}

/**
 * Turnos del período para prefactura. Misma lectura que el dashboard (`loadPeriodTurnosForClients`).
 */
export async function loadClientTurnosForClient(
  client: ClientRef,
  start: Date,
  end: Date,
  opts?: TurnoQueryOpts,
): Promise<any[]> {
  return loadPeriodTurnosForClients([client], start, end, opts);
}

/**
 * Turnos del dashboard CRM. Reutiliza la misma lectura que la prefactura.
 */
export async function fetchCrmDashboardTurnos(
  empresaId: string,
  scopeEmpresa: boolean,
  rangeStart: Date | null,
  rangeEnd: Date | null,
  clientRefs: ClientRef[],
  migracionCompleta = true,
): Promise<any[]> {
  const start = rangeStart ? new Date(rangeStart) : new Date(2000, 0, 1);
  const end = rangeEnd ? new Date(rangeEnd) : new Date(2099, 11, 31, 23, 59, 59, 999);
  return loadPeriodTurnosForClients(clientRefs, start, end, {
    empresaId,
    scopeEmpresa,
    migracionCompleta,
  });
}
