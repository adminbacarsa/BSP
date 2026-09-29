/**
 * Dueño actual de un objectiveId = el cliente de la MISMA empresa que lo tiene en objetivos[].
 * Mismo criterio que el trigger I1 (`apps/functions/src/integrity/turnoClientOwner.ts`).
 * Puro, sin Firebase: lo usan el motor del libro de horas (Functions) y el lector del CRM.
 * Nunca resuelve por el clientId del turno / ausencia / SLA ni por el mapa fijo de huérfanos.
 */

export type OwnerClientLike = {
  id: string;
  name?: unknown;
  razonSocial?: unknown;
  status?: unknown;
  objetivos?: Array<{ id?: unknown; objectiveId?: unknown; name?: unknown; nombre?: unknown }>;
  objectives?: Array<{ id?: unknown; objectiveId?: unknown; name?: unknown; nombre?: unknown }>;
};

export type ObjectiveOwner = { clientId: string; clientName: string };

export type ObjectiveOwnerIndex = {
  byObjectiveId: Map<string, OwnerClientLike[]>;
  byObjectiveName: Map<string, OwnerClientLike[]>;
  byClientName: Map<string, OwnerClientLike[]>;
  clientById: Map<string, OwnerClientLike>;
};

export function normalizeOwnerName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

export function ownerClientActive(status: unknown): boolean {
  const u = String(status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE' || u === '';
}

function ownerClientName(c: OwnerClientLike): string {
  return String(c.name || c.razonSocial || '').trim();
}

function push(map: Map<string, OwnerClientLike[]>, key: string, c: OwnerClientLike) {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.some((x) => x.id === c.id)) list.push(c);
  map.set(key, list);
}

export function buildObjectiveOwnerIndex(clients: OwnerClientLike[]): ObjectiveOwnerIndex {
  const index: ObjectiveOwnerIndex = {
    byObjectiveId: new Map(),
    byObjectiveName: new Map(),
    byClientName: new Map(),
    clientById: new Map(),
  };
  for (const c of clients || []) {
    const id = String(c?.id || '').trim();
    if (!id) continue;
    index.clientById.set(id, c);
    push(index.byClientName, normalizeOwnerName(c.name || c.razonSocial), c);
    const objs = c.objetivos || c.objectives || [];
    for (const o of objs) {
      push(index.byObjectiveId, String(o?.id ?? o?.objectiveId ?? '').trim(), c);
      push(index.byObjectiveName, normalizeOwnerName(o?.name ?? o?.nombre), c);
    }
  }
  return index;
}

/** Con varios dueños gana el activo; si hay varios activos, el primero (orden estable del listado). */
function pickOwner(list: OwnerClientLike[] | undefined): OwnerClientLike | null {
  if (!list || list.length === 0) return null;
  const active = list.filter((c) => ownerClientActive(c.status));
  return active[0] || list[0];
}

/**
 * Dueño actual del objetivo. Orden: objetivos[].id → objetivos[].name → nombre del cliente (solo activos).
 * Sin dueño devuelve null: el llamador lo deja como «sin cliente», no inventa clientId.
 */
export function resolveObjectiveOwner(
  index: ObjectiveOwnerIndex,
  objectiveId: string,
  hints?: { objectiveName?: unknown; clientName?: unknown },
): ObjectiveOwner | null {
  const oid = String(objectiveId || '').trim();
  let owner = oid ? pickOwner(index.byObjectiveId.get(oid)) : null;
  if (!owner) {
    const oname = normalizeOwnerName(hints?.objectiveName);
    if (oname) owner = pickOwner(index.byObjectiveName.get(oname));
  }
  if (!owner) {
    const cname = normalizeOwnerName(hints?.clientName);
    const candidates = cname ? (index.byClientName.get(cname) || []).filter((c) => ownerClientActive(c.status)) : [];
    owner = candidates[0] || null;
  }
  if (!owner) return null;
  return { clientId: String(owner.id), clientName: ownerClientName(owner) };
}
