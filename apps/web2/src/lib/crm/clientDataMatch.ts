import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView, empresaCollectionQuery, getClientIdAliases, tenantEmpresaIdsMatch } from '@/lib/multiempresa';
import { getDateKeyInTimezone, resolveTurnoScheduleDateKey } from '@/lib/crm/crmDateUtils';

export type ClientRef = {
  id: string;
  name?: string;
  legalName?: string;
  objetivos?: Array<{ id?: string; name?: string }>;
};

function normalizeClientName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

function objectiveIdsForClient(client: ClientRef): Set<string> {
  const ids = new Set<string>();
  for (const o of client.objetivos || []) {
    const id = String(o.id ?? '').trim();
    const name = String(o.name ?? '').trim();
    if (id) ids.add(id);
    if (name) ids.add(name);
  }
  return ids;
}

async function fetchTurnosByObjectiveIds(
  objectiveIds: string[],
  addIfInRange: (id: string, data: Record<string, unknown>) => void,
  padStart?: Date,
  padEnd?: Date,
): Promise<void> {
  const ids = [...new Set(objectiveIds.map((x) => String(x).trim()).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    // Con rango de fechas disponible limitamos las lecturas al período relevante.
    // Requiere índice compuesto en Firestore: objectiveId ASC, startTime ASC.
    const q = padStart && padEnd
      ? query(
          collection(db, 'turnos'),
          where('objectiveId', 'in', chunk),
          where('startTime', '>=', Timestamp.fromDate(padStart)),
          where('startTime', '<=', Timestamp.fromDate(padEnd)),
        )
      : query(collection(db, 'turnos'), where('objectiveId', 'in', chunk));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
  }
}

export function clientRowMatchesClient(row: Record<string, unknown>, client: ClientRef): boolean {
  const aliases = new Set(getClientIdAliases(client.id));
  const rowCid = String(row.clientId ?? '').trim();
  if (rowCid && aliases.has(rowCid)) return true;

  const objectiveIds = objectiveIdsForClient(client);
  const rowOid = String(row.objectiveId ?? '').trim();
  if (rowOid && objectiveIds.has(rowOid)) return true;

  const clientNames = [client.name, client.legalName]
    .map(normalizeClientName)
    .filter(Boolean);
  if (clientNames.length === 0) return false;

  const rowNames = [row.clientName, row.client, row.name]
    .map(normalizeClientName)
    .filter(Boolean);

  return rowNames.some((rn) => clientNames.some((cn) => rn === cn || rn.includes(cn) || cn.includes(rn)));
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

/**
 * Turnos del período para pre-factura / CRM.
 * 1) Por clientId (aliases legacy).
 * 2) Por objectiveId de la ficha CRM (cronogramas con clientId viejo).
 * 3) Respaldo por rango + match cliente/objetivo.
 */
export async function loadClientTurnosForClient(
  client: ClientRef,
  start: Date,
  end: Date,
  opts?: { empresaId?: string; scopeEmpresa?: boolean },
): Promise<any[]> {
  const byId = new Map<string, any>();
  const aliases = getClientIdAliases(client.id);
  const objectiveIds = [...objectiveIdsForClient(client)];

  const rangeStartKey = getDateKeyInTimezone(start);
  const rangeEndKey = getDateKeyInTimezone(end);

  const addIfInRange = (id: string, data: Record<string, unknown>) => {
    const st = toDateSafe(data.startTime);
    const scheduleKey =
      resolveTurnoScheduleDateKey(data as Record<string, unknown>) || (st ? getDateKeyInTimezone(st) : null);
    const inRangeByStart = !!st && st >= start && st <= end;
    const inRangeBySchedule =
      !!scheduleKey && scheduleKey >= rangeStartKey && scheduleKey <= rangeEndKey;
    if (!inRangeByStart && !inRangeBySchedule) return;
    const rowCid = String(data.clientId ?? '').trim();
    byId.set(id, { id, ...data, clientId: rowCid || client.id });
  };

  // Índice (clientId, startTime) ya existe en firestore.indexes.json.
  // Pad de 1 día para cubrir turnos nocturnos que empiezan fuera del rango exacto.
  const padStart = new Date(start); padStart.setDate(padStart.getDate() - 1);
  const padEnd   = new Date(end);   padEnd.setDate(padEnd.getDate() + 1);
  await Promise.all(
    aliases.map(async (cid) => {
      const snap = await getDocs(query(
        collection(db, 'turnos'),
        where('clientId', '==', cid),
        where('startTime', '>=', Timestamp.fromDate(padStart)),
        where('startTime', '<=', Timestamp.fromDate(padEnd)),
      ));
      snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
    }),
  );

  if (objectiveIds.length > 0) {
    await fetchTurnosByObjectiveIds(objectiveIds, addIfInRange, start, end);
  }

  const empresaId = String(opts?.empresaId ?? '').trim();
  const scopeEmpresa = opts?.scopeEmpresa === true && !!empresaId;
  const q = query(
    empresaCollectionQuery('turnos', empresaId, scopeEmpresa) as ReturnType<typeof query>,
    where('startTime', '>=', Timestamp.fromDate(start)),
    where('startTime', '<=', Timestamp.fromDate(end)),
  );

  const snap = await getDocs(q);
  snap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    if (!clientRowMatchesClient(data, client)) return;
    addIfInRange(d.id, data);
  });

  return [...byId.values()];
}

function turnoInDashboardRange(
  data: Record<string, unknown>,
  rangeStart: Date | null,
  rangeEnd: Date | null,
): boolean {
  if (!rangeStart || !rangeEnd) return true;
  const padStart = new Date(rangeStart);
  const padEnd = new Date(rangeEnd);
  padStart.setDate(padStart.getDate() - 2);
  padEnd.setDate(padEnd.getDate() + 2);
  padEnd.setHours(23, 59, 59, 999);
  const rangeStartKey = getDateKeyInTimezone(padStart);
  const rangeEndKey = getDateKeyInTimezone(padEnd);
  const st = toDateSafe(data.startTime);
  const scheduleKey =
    resolveTurnoScheduleDateKey(data) || (st ? getDateKeyInTimezone(st) : null);
  const inRangeByStart = !!st && st >= padStart && st <= padEnd;
  const inRangeBySchedule =
    !!scheduleKey && scheduleKey >= rangeStartKey && scheduleKey <= rangeEndKey;
  return inRangeByStart || inRangeBySchedule;
}

/**
 * Turnos del dashboard CRM — misma estrategia que pre-factura (clientId + objectiveId + rango),
 * sin depender de índice compuesto clientId+startTime.
 */
export async function fetchCrmDashboardTurnos(
  empresaId: string,
  scopeEmpresa: boolean,
  rangeStart: Date | null,
  rangeEnd: Date | null,
  clientRefs: ClientRef[],
): Promise<any[]> {
  const byId = new Map<string, any>();
  const start = rangeStart ? new Date(rangeStart) : new Date(2000, 0, 1);
  const end = rangeEnd ? new Date(rangeEnd) : new Date(2099, 11, 31, 23, 59, 59, 999);
  const padStart = new Date(start);
  const padEnd = new Date(end);
  padStart.setDate(padStart.getDate() - 2);
  padEnd.setDate(padEnd.getDate() + 2);
  padEnd.setHours(23, 59, 59, 999);

  const addIfInRange = (id: string, data: Record<string, unknown>) => {
    if (!turnoInDashboardRange(data, rangeStart, rangeEnd)) return;
    byId.set(id, { id, ...data });
  };

  const aliases = collectClientIdAliases(clientRefs);
  const objectiveIds = [
    ...new Set(clientRefs.flatMap((c) => [...objectiveIdsForClient(c)])),
  ];

  const col = empresaCollectionQuery('turnos', empresaId, scopeEmpresa);
  const batchQueries: Promise<void>[] = [];

  for (let i = 0; i < aliases.length; i += 10) {
    const chunk = aliases.slice(i, i + 10);
    batchQueries.push(
      getDocs(query(col as ReturnType<typeof query>, where('clientId', 'in', chunk)))
        .then((snap) => {
          snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
        })
        .catch((err) => console.warn('CRM dashboard: turnos por clientId', err)),
    );
  }

  if (objectiveIds.length > 0) {
    batchQueries.push(fetchTurnosByObjectiveIds(objectiveIds, addIfInRange, padStart, padEnd));
  }

  await Promise.all(batchQueries);

  try {
    const ranged = query(
      col as ReturnType<typeof query>,
      where('startTime', '>=', Timestamp.fromDate(padStart)),
      where('startTime', '<=', Timestamp.fromDate(padEnd)),
    );
    const snap = await getDocs(ranged);
    snap.docs.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      if (!clientRefs.some((c) => clientRowMatchesClient(data, c))) return;
      addIfInRange(d.id, data);
    });
  } catch (err) {
    console.warn('CRM dashboard: turnos por rango', err);
  }

  return [...byId.values()];
}
