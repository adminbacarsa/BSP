/**
 * Dueño de un objectiveId = el único cliente de la misma empresa que lo tiene en objetivos[].
 * El trigger corrige clientId del turno con una sola escritura. Si ya coincide, no escribe.
 */

export const OBJETIVO_SIN_CLIENTE = 'OBJETIVO_SIN_CLIENTE';

const CACHE_TTL_MS = 5 * 60 * 1000;

export type ObjectiveOwnerMap = Map<string, string[]>;

type CacheEntry = { at: number; owners: ObjectiveOwnerMap };

const ownerCache = new Map<string, CacheEntry>();

export function resetObjectiveOwnerCache(): void {
  ownerCache.clear();
}

export type ClientOwnerSource = {
  id: string;
  data: () => {
    objetivos?: Array<{ id?: unknown; objectiveId?: unknown }>;
    objectives?: Array<{ id?: unknown; objectiveId?: unknown }>;
  };
};

export type ClientsQueryDb = {
  collection: (name: string) => {
    where: (
      field: string,
      op: string,
      value: string,
    ) => {
      get: () => Promise<{ docs: ClientOwnerSource[] }>;
    };
  };
};

export function buildObjectiveOwnerMap(docs: ClientOwnerSource[]): ObjectiveOwnerMap {
  const owners: ObjectiveOwnerMap = new Map();
  for (const doc of docs) {
    const data = doc.data() || {};
    const raw = data.objetivos || data.objectives || [];
    for (const row of raw) {
      const objectiveId = String(row?.id ?? row?.objectiveId ?? '').trim();
      if (!objectiveId) continue;
      const list = owners.get(objectiveId) || [];
      if (!list.includes(doc.id)) list.push(doc.id);
      owners.set(objectiveId, list);
    }
  }
  return owners;
}

export async function loadObjectiveOwnerMap(
  db: ClientsQueryDb,
  empresaId: string,
  now = Date.now(),
): Promise<ObjectiveOwnerMap> {
  const empresa = String(empresaId || '').trim();
  if (!empresa) return new Map();
  const hit = ownerCache.get(empresa);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.owners;
  const snap = await db.collection('clients').where('empresaId', '==', empresa).get();
  const owners = buildObjectiveOwnerMap(snap.docs);
  ownerCache.set(empresa, { at: now, owners });
  return owners;
}

export type TurnoClientPatch = {
  clientId?: string;
  /** null = borrar el campo integrityIssue en la misma escritura. */
  integrityIssue?: string | null;
};

/**
 * null = no escribir (ya está bien, o no hay un dueño único que afirmar).
 * Un objetivo sin ningún cliente de la empresa marca OBJETIVO_SIN_CLIENTE y no inventa clientId.
 */
export function planTurnoClientPatch(
  turno: {
    empresaId?: unknown;
    objectiveId?: unknown;
    clientId?: unknown;
    integrityIssue?: unknown;
  },
  owners: ObjectiveOwnerMap,
): TurnoClientPatch | null {
  const empresaId = String(turno.empresaId ?? '').trim();
  const objectiveId = String(turno.objectiveId ?? '').trim();
  if (!empresaId || !objectiveId) return null;

  const clientId = String(turno.clientId ?? '').trim();
  const issue = String(turno.integrityIssue ?? '').trim();
  const ownerIds = owners.get(objectiveId) || [];

  if (ownerIds.length === 1) {
    if (clientId === ownerIds[0]) return null;
    const patch: TurnoClientPatch = { clientId: ownerIds[0] };
    if (issue) patch.integrityIssue = null;
    return patch;
  }

  if (ownerIds.length === 0) {
    if (issue === OBJETIVO_SIN_CLIENTE) return null;
    return { integrityIssue: OBJETIVO_SIN_CLIENTE };
  }

  return null;
}

type TurnoRef = {
  update: (patch: Record<string, unknown>) => Promise<unknown>;
};

/** Aplica el parche. El llamador traduce integrityIssue null a FieldValue.delete(). */
export async function correctTurnoClientId(
  db: ClientsQueryDb,
  ref: TurnoRef,
  data: Record<string, unknown>,
  writePatch: (patch: TurnoClientPatch) => Record<string, unknown>,
): Promise<'updated' | 'noop'> {
  const empresaId = String(data.empresaId ?? '').trim();
  if (!empresaId) return 'noop';
  const owners = await loadObjectiveOwnerMap(db, empresaId);
  const patch = planTurnoClientPatch(data, owners);
  if (!patch) return 'noop';
  await ref.update(writePatch(patch));
  return 'updated';
}
