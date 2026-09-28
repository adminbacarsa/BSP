/**
 * Coincidencia de filas (turnos, SLA) con un cliente: por id/alias, objetivo o nombre.
 * Puro, sin Firebase. `clientDataMatch.ts` lo re-exporta.
 */
import { getClientIdAliases } from '@/lib/tenantScope';

export type ClientRef = {
  id: string;
  name?: string;
  legalName?: string;
  objetivos?: Array<{ id?: string; name?: string }>;
};

export function normalizeClientName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

export function objectiveIdsForClient(client: ClientRef): Set<string> {
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
