import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { belongsToEmpresaView, empresaCollectionQuery, getClientIdAliases } from '@/lib/multiempresa';
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
): Promise<void> {
  const ids = [...new Set(objectiveIds.map((x) => String(x).trim()).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await getDocs(query(collection(db, 'turnos'), where('objectiveId', 'in', chunk)));
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

/** Una lectura de servicios_sla + misma lógica de match que loadClientSlaForClient (sin N×Firestore). */
export function indexSlaRowsByClients(
  slaRows: any[],
  clients: ClientRef[],
): Map<string, any[]> {
  const map = new Map<string, any[]>();
  const add = (clientId: string, row: any) => {
    const arr = map.get(clientId);
    if (!arr) return;
    if (!arr.some((r) => r.id === row.id)) arr.push(row);
  };
  for (const c of clients) {
    map.set(c.id, []);
  }
  for (const s of slaRows) {
    const canon = resolveCanonicalClientIdFromList(s.clientId, clients);
    if (canon) {
      add(canon, s);
      continue;
    }
    for (const c of clients) {
      if (!clientRowMatchesClient(s, c)) continue;
      add(c.id, s);
    }
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
 * SLA del dashboard: una lectura tenant (+ `in` por clientId solo si hace falta).
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

  const baseSnap = await getDocs(
    empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>,
  );
  baseSnap.docs.forEach((d) => ingest(d.id, d.data() as Record<string, unknown>));

  const empKey = String(empresaId ?? '').trim().toLowerCase();
  const needsAliasSupplement = scopeEmpresa && empKey !== 'bacarsa' && clients.length > 0;
  if (needsAliasSupplement) {
    await fetchRowsByClientIdInBatches('servicios_sla', [...tenantAliasSet], ingest);
  }

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

  const byId = new Map<string, any>();
  snap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    if (!clientRowMatchesClient(data, client)) return;
    byId.set(d.id, { id: d.id, ...data });
  });

  return [...byId.values()];
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

  await Promise.all(
    aliases.map(async (cid) => {
      const snap = await getDocs(query(collection(db, 'turnos'), where('clientId', '==', cid)));
      snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
    }),
  );

  if (objectiveIds.length > 0) {
    await fetchTurnosByObjectiveIds(objectiveIds, addIfInRange);
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
