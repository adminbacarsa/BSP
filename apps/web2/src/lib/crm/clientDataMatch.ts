import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { empresaCollectionQuery, getClientIdAliases } from '@/lib/multiempresa';
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

async function queryByClientIdAliases<T extends Record<string, unknown>>(
  collectionName: string,
  client: ClientRef,
  mapDoc: (id: string, data: Record<string, unknown>) => T,
): Promise<T[]> {
  const byId = new Map<string, T>();
  const aliases = getClientIdAliases(client.id);

  await Promise.all(
    aliases.map(async (cid) => {
      const snap = await getDocs(query(collection(db, collectionName), where('clientId', '==', cid)));
      snap.docs.forEach((d) => byId.set(d.id, mapDoc(d.id, d.data() as Record<string, unknown>)));
    }),
  );

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

export async function loadClientTurnosForClient(
  client: ClientRef,
  start: Date,
  end: Date,
  opts?: { empresaId?: string; scopeEmpresa?: boolean },
): Promise<any[]> {
  const byId = new Map<string, any>();
  const aliases = getClientIdAliases(client.id);

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
    byId.set(id, { id, ...data, clientId: client.id });
  };

  await Promise.all(
    aliases.map(async (cid) => {
      const snap = await getDocs(query(collection(db, 'turnos'), where('clientId', '==', cid)));
      snap.docs.forEach((d) => addIfInRange(d.id, d.data() as Record<string, unknown>));
    }),
  );

  if (byId.size > 0) return [...byId.values()];

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
