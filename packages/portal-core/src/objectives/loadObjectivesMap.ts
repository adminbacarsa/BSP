import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { ObjectiveLocation } from '@cosp/portal-types';

import { OBJECTIVE_LOCATION_LOAD_ERROR } from './objectiveMessages';

export { OBJECTIVE_LOCATION_LOAD_ERROR, OBJECTIVE_NOT_FOUND_MESSAGE } from './objectiveMessages';

export type ObjectiveDocLike = { id: string; data: Record<string, unknown> };

/** Un doc de la colección `objetivos`. */
export function objectiveEntryFromDoc(id: string, data: Record<string, unknown>): ObjectiveLocation {
  return {
    lat: Number(data.lat || data.latitude || 0),
    lng: Number(data.lng || data.longitude || 0),
    name: String(data.name || data.nombre || id),
    clientName: String(data.clientName || data.nombreCliente || ''),
    address: String(data.address || data.direccion || ''),
    allowRemoteCheckIn: data.allowRemoteCheckIn === true,
  };
}

/** Un objetivo embebido en `clients.objetivos[]`. */
export function objectiveEntryFromEmbedded(
  o: Record<string, unknown>,
  clientName: string,
): ObjectiveLocation {
  return {
    lat: Number(o.lat || o.latitude || 0),
    lng: Number(o.lng || o.longitude || 0),
    name: String(o.name || o.nombre || o.id || ''),
    clientName: String(o.clientName || clientName),
    address: String(o.address || o.direccion || ''),
    allowRemoteCheckIn: o.allowRemoteCheckIn === true,
  };
}

function clientNameOf(cdata: Record<string, unknown>): string {
  return String(cdata.name || cdata.nombre || cdata.razonSocial || '');
}

function embeddedObjectives(cdata: Record<string, unknown>): Record<string, unknown>[] {
  const raw = cdata.objetivos;
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

/** Mapa id/nombre → ubicación a partir de docs ya leídos (puro, testeable sin Firestore). */
export function buildObjectivesMap(
  objetivos: ObjectiveDocLike[],
  clients: ObjectiveDocLike[],
): Record<string, ObjectiveLocation> {
  const map: Record<string, ObjectiveLocation> = {};
  const addEntry = (key: unknown, entry: ObjectiveLocation) => {
    const k = String(key ?? '').trim();
    if (k) map[k] = entry;
  };

  for (const { id, data } of objetivos) {
    const entry = objectiveEntryFromDoc(id, data);
    addEntry(id, entry);
    addEntry(data.name, entry);
    addEntry(data.nombre, entry);
    addEntry(data.id, entry);
  }

  for (const { data } of clients) {
    const clientName = clientNameOf(data);
    for (const o of embeddedObjectives(data)) {
      const entry = objectiveEntryFromEmbedded(o, clientName);
      addEntry(o.id, entry);
      addEntry(o.name, entry);
      addEntry(o.nombre, entry);
    }
  }

  return map;
}

/** Busca el objetivo dentro de `clients.objetivos[]` por id y, si no, por nombre. */
export function findEmbeddedObjective(
  cdata: Record<string, unknown>,
  objectiveId?: string | null,
  objectiveName?: string | null,
): ObjectiveLocation | null {
  const id = String(objectiveId ?? '').trim();
  const name = String(objectiveName ?? '').trim();
  const list = embeddedObjectives(cdata);
  const byId = id ? list.find((o) => String(o.id ?? '').trim() === id) : undefined;
  const byName = !byId && name
    ? list.find((o) => String(o.name ?? o.nombre ?? '').trim() === name)
    : undefined;
  const hit = byId ?? byName;
  return hit ? objectiveEntryFromEmbedded(hit, clientNameOf(cdata)) : null;
}

export type LoadObjectivesMapOptions = {
  /** Empresas del guardia (varias si es eventual). Con lista, se filtra por `empresaId`. */
  empresaIds?: readonly string[] | null;
  onError?: (scope: 'objetivos' | 'clients', error: unknown) => void;
};

export type LoadObjectivesMapResult = {
  map: Record<string, ObjectiveLocation>;
  /** Alguna lectura falló (reglas, red). El mapa puede estar incompleto. */
  error: boolean;
};

function logRead(scope: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn(`[loadObjectivesMap] ${scope}: ${msg}`);
}

async function readCollection(
  db: Firestore,
  name: 'objetivos' | 'clients',
  empresaIds: readonly string[],
): Promise<ObjectiveDocLike[]> {
  const base = collection(db, name);
  const q = empresaIds.length === 0
    ? base
    : empresaIds.length === 1
      ? query(base, where('empresaId', '==', empresaIds[0]))
      : query(base, where('empresaId', 'in', empresaIds.slice(0, 30)));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
}

/**
 * Mapa de objetivos para mostrar cliente/objetivo y validar GPS. Lee `objetivos` y `clients`
 * filtrados por empresa (lo que las reglas permiten a admin de empresa; el guardia y el SA pueden
 * leer todo). Si una lectura falla se avisa (`error`) y se loguea: nunca se confunde con
 * «sin ubicación».
 */
export async function loadObjectivesMapDetailed(
  db: Firestore,
  opts?: LoadObjectivesMapOptions,
): Promise<LoadObjectivesMapResult> {
  const empresaIds = (opts?.empresaIds ?? []).map((e) => String(e ?? '').trim()).filter(Boolean);
  const onError = opts?.onError ?? logRead;
  let error = false;
  let objetivos: ObjectiveDocLike[] = [];
  let clients: ObjectiveDocLike[] = [];

  try {
    objetivos = await readCollection(db, 'objetivos', empresaIds);
  } catch (e) {
    error = true;
    onError('objetivos', e);
  }
  try {
    clients = await readCollection(db, 'clients', empresaIds);
  } catch (e) {
    error = true;
    onError('clients', e);
  }

  return { map: buildObjectivesMap(objetivos, clients), error };
}

export async function loadObjectivesMap(
  db: Firestore,
  opts?: LoadObjectivesMapOptions,
): Promise<Record<string, ObjectiveLocation>> {
  return (await loadObjectivesMapDetailed(db, opts)).map;
}

export function getObjectiveForShift(
  objectivesMap: Record<string, ObjectiveLocation>,
  objectiveId?: string,
  objectiveName?: string,
): ObjectiveLocation | null {
  if (objectiveId && objectivesMap[objectiveId]) return objectivesMap[objectiveId];
  if (objectiveName && objectivesMap[objectiveName]) return objectivesMap[objectiveName];
  return null;
}

/** Lecturas mínimas para resolver un objetivo puntual (inyectable en tests). */
export type ObjectiveReader = {
  getClient: (clientId: string) => Promise<Record<string, unknown> | null>;
  getObjetivo: (objectiveId: string) => Promise<Record<string, unknown> | null>;
  listClientsByEmpresa: (empresaId: string) => Promise<ObjectiveDocLike[]>;
};

export function firestoreObjectiveReader(db: Firestore): ObjectiveReader {
  return {
    getClient: async (clientId) => {
      const snap = await getDoc(doc(db, 'clients', clientId));
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    },
    getObjetivo: async (objectiveId) => {
      const snap = await getDoc(doc(db, 'objetivos', objectiveId));
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    },
    listClientsByEmpresa: async (empresaId) => readCollection(db, 'clients', [empresaId]),
  };
}

export type ObjectiveLocationLookup =
  | { status: 'found'; location: ObjectiveLocation; source: 'map' | 'client' | 'objetivos' | 'empresa' }
  | { status: 'not_found' }
  | { status: 'error'; message: string; errors: unknown[] };

export type ShiftObjectiveRef = {
  objectiveId?: string | null;
  objectiveName?: string | null;
  clientId?: string | null;
  empresaId?: string | null;
};

/**
 * Ubicación del objetivo de un turno leyendo solo lo necesario y en el orden que las reglas
 * permiten a cualquier guardia: el mapa ya cargado → `clients/{clientId}` del turno →
 * `objetivos/{objectiveId}` → clientes de la empresa del turno.
 * Devuelve `error` si alguna lectura falló y no se encontró: no se puede afirmar «sin ubicación».
 */
export async function resolveObjectiveLocationForShift(
  reader: ObjectiveReader,
  shift: ShiftObjectiveRef,
  objectivesMap: Record<string, ObjectiveLocation> = {},
): Promise<ObjectiveLocationLookup> {
  const objectiveId = String(shift.objectiveId ?? '').trim();
  const objectiveName = String(shift.objectiveName ?? '').trim();
  const clientId = String(shift.clientId ?? '').trim();
  const empresaId = String(shift.empresaId ?? '').trim();

  const fromMap = getObjectiveForShift(objectivesMap, objectiveId || undefined, objectiveName || undefined);
  if (fromMap) return { status: 'found', location: fromMap, source: 'map' };

  const errors: unknown[] = [];

  if (clientId) {
    try {
      const cdata = await reader.getClient(clientId);
      const hit = cdata ? findEmbeddedObjective(cdata, objectiveId, objectiveName) : null;
      if (hit) return { status: 'found', location: hit, source: 'client' };
    } catch (e) {
      errors.push(e);
    }
  }

  if (objectiveId) {
    try {
      const odata = await reader.getObjetivo(objectiveId);
      if (odata) return { status: 'found', location: objectiveEntryFromDoc(objectiveId, odata), source: 'objetivos' };
    } catch (e) {
      errors.push(e);
    }
  }

  if (empresaId && (objectiveId || objectiveName)) {
    try {
      const clients = await reader.listClientsByEmpresa(empresaId);
      for (const { data } of clients) {
        const hit = findEmbeddedObjective(data, objectiveId, objectiveName);
        if (hit) return { status: 'found', location: hit, source: 'empresa' };
      }
    } catch (e) {
      errors.push(e);
    }
  }

  if (errors.length > 0) {
    return { status: 'error', message: OBJECTIVE_LOCATION_LOAD_ERROR, errors };
  }
  return { status: 'not_found' };
}
