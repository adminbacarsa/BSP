/**
 * Snapshot de Análisis: catálogo (1× empresa) + hechos con merge de rango.
 * Los turnos NO se persisten en sessionStorage (pueden ser ~18k docs).
 */

import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  belongsToEmpresaView,
  empresaCollectionQuery,
  filterRowsByEmpresa,
} from '@/lib/multiempresa';
import { readSessionJson, writeSessionJson } from '@/lib/persistSession';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import {
  type MsRange,
  type ObjectiveGeoEntry,
  envelopingRange,
  gapsToFetch,
  isRangeCovered,
  mergeDocsById,
  mergeIntervals,
  filterTurnosInRange,
  filterAusenciasLoose,
} from './analisisQueries';

const META_KEY = 'cosp:analisis:snap-meta';

export type AnalisisSnapMeta = {
  empresaId: string;
  catalogAt: number | null;
  factsAt: number | null;
  intervals: MsRange[];
};

export type AnalisisMemoryStore = {
  empresaId: string;
  services: any[];
  employees: any[];
  objectivesGeoById: Record<string, ObjectiveGeoEntry>;
  tiposNovedad: NovedadType[];
  turnos: any[];
  ausencias: any[];
  intervals: MsRange[];
  catalogAt: number | null;
  factsAt: number | null;
  ausenciasLoaded: boolean;
};

let memoryStore: AnalisisMemoryStore | null = null;

function readMeta(): AnalisisSnapMeta | null {
  return readSessionJson<AnalisisSnapMeta>(META_KEY);
}

function writeMeta(meta: AnalisisSnapMeta) {
  writeSessionJson(META_KEY, meta);
}

export function getAnalisisMemoryStore(): AnalisisMemoryStore | null {
  return memoryStore;
}

export function resetAnalisisMemoryStore() {
  memoryStore = null;
}

function ensureStore(empresaId: string): AnalisisMemoryStore {
  if (!memoryStore || memoryStore.empresaId !== empresaId) {
    memoryStore = {
      empresaId,
      services: [],
      employees: [],
      objectivesGeoById: {},
      tiposNovedad: [],
      turnos: [],
      ausencias: [],
      intervals: [],
      catalogAt: null,
      factsAt: null,
      ausenciasLoaded: false,
    };
  }
  return memoryStore;
}

function persistMeta(store: AnalisisMemoryStore) {
  writeMeta({
    empresaId: store.empresaId,
    catalogAt: store.catalogAt,
    factsAt: store.factsAt,
    intervals: store.intervals,
  });
}

export function storeCoversRange(store: AnalisisMemoryStore | null, start: Date, end: Date): boolean {
  if (!store) return false;
  return isRangeCovered(store.intervals, { startMs: start.getTime(), endMs: end.getTime() });
}

type ScopeOpts = {
  empresaId: string;
  scopeEmpresa: boolean;
  migracionCompleta: boolean;
};

function mapTurnoDocs(
  docs: Array<{ id: string; data: () => any }>,
  opts: ScopeOpts,
  empIds: Set<string>,
): any[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t: any) => {
      if (t.type === 'NOVEDAD' || !t.startTime || !t.endTime) return false;
      if (!belongsToEmpresaView(t, opts.empresaId, opts.migracionCompleta)) return false;
      if (empIds.size > 0 && t.employeeId && t.employeeId !== 'VACANTE' && !empIds.has(t.employeeId)) {
        return false;
      }
      return true;
    });
}

async function fetchTurnosRange(range: MsRange, opts: ScopeOpts, empIds: Set<string>): Promise<any[]> {
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
  const snap = await getDocs(query(
    collection(db, 'turnos'),
    where('startTime', '>=', Timestamp.fromDate(start)),
    where('startTime', '<=', Timestamp.fromDate(end)),
  ));
  return mapTurnoDocs(snap.docs, opts, empIds);
}

async function fetchAusenciasAll(opts: ScopeOpts, empIds: Set<string>): Promise<any[]> {
  const snap = await getDocs(
    empresaCollectionQuery('ausencias', opts.empresaId, opts.scopeEmpresa) as ReturnType<typeof query>,
  );
  return filterRowsByEmpresa(
    snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    opts.empresaId,
    opts.scopeEmpresa,
    opts.migracionCompleta,
  ).filter((a: any) => {
    if (empIds.size > 0 && a.employeeId && !empIds.has(a.employeeId)) return false;
    return true;
  });
}

export async function fetchAnalisisCatalog(opts: ScopeOpts): Promise<{
  services: any[];
  employees: any[];
  objectivesGeoById: Record<string, ObjectiveGeoEntry>;
  tiposNovedad: NovedadType[];
}> {
  const { empresaId, scopeEmpresa, migracionCompleta } = opts;
  const [sSnap, eSnap] = await Promise.all([
    getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>),
    getDocs(empresaCollectionQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>),
  ]);
  const services = filterRowsByEmpresa(
    sSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    empresaId,
    scopeEmpresa,
    migracionCompleta,
  );
  const employees = filterRowsByEmpresa(
    eSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    empresaId,
    scopeEmpresa,
    migracionCompleta,
  ).filter((e: any) => !['inactive', 'baja', 'inactivo'].includes(String(e.status || '').toLowerCase()));

  const map: Record<string, ObjectiveGeoEntry> = {};
  const add = (key: string, lat: number, lng: number, name: string, clientName: string) => {
    const k = String(key || '').trim();
    if (!k || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    map[k] = { lat, lng, name: name || k, clientName: clientName || '' };
  };
  try {
    const snap = await getDocs(collection(db, 'objetivos'));
    snap.forEach((d) => {
      const data = d.data();
      const lat = Number(data.lat ?? data.latitude);
      const lng = Number(data.lng ?? data.longitude);
      const name = String(data.name || data.nombre || d.id);
      const clientName = String(data.clientName || data.nombreCliente || '');
      add(d.id, lat, lng, name, clientName);
      if (data.name) add(String(data.name), lat, lng, name, clientName);
      if (data.nombre) add(String(data.nombre), lat, lng, name, clientName);
      if (data.id != null) add(String(data.id), lat, lng, name, clientName);
    });
  } catch (e) {
    console.error(e);
  }
  try {
    const clientsSnap = await getDocs(
      empresaCollectionQuery('clients', empresaId, scopeEmpresa) as ReturnType<typeof query>,
    );
    clientsSnap.forEach((cd) => {
      const cdata = cd.data();
      const clientName = String(cdata.name || cdata.nombre || cdata.razonSocial || '');
      (cdata.objetivos || []).forEach((o: any) => {
        const lat = Number(o.lat ?? o.latitude);
        const lng = Number(o.lng ?? o.longitude);
        const name = String(o.name || o.nombre || o.id || '');
        const cn = String(o.clientName || clientName || '');
        if (o.id != null) add(String(o.id), lat, lng, name, cn);
        if (o.name) add(String(o.name), lat, lng, name, cn);
        if (o.nombre) add(String(o.nombre), lat, lng, name, cn);
      });
    });
  } catch (e) {
    console.error(e);
  }

  let tiposNovedad: NovedadType[] = [];
  try {
    const tSnap = await getDocs(
      empresaCollectionQuery('tipos_novedad', empresaId, scopeEmpresa) as ReturnType<typeof query>,
    );
    tiposNovedad = filterRowsByEmpresa(
      tSnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          empresaId: data.empresaId ? String(data.empresaId) : undefined,
          label: String(data.label || '').trim(),
          code: (String(data.code || 'L').toUpperCase() as NovedadType['code']) || 'L',
          defaultDays: typeof data.defaultDays === 'number' ? data.defaultDays : null,
          requiresAuth: data.requiresAuth !== false,
          medicalVerification: data.medicalVerification === true,
          status: String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
          sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 999,
          isSystem: data.isSystem === true,
        } as NovedadType;
      }),
      empresaId,
      scopeEmpresa,
      migracionCompleta,
    ).filter((t) => t.label);
  } catch (e) {
    console.error(e);
  }

  const store = ensureStore(empresaId);
  store.services = services;
  store.employees = employees;
  store.objectivesGeoById = map;
  store.tiposNovedad = tiposNovedad;
  store.catalogAt = Date.now();
  persistMeta(store);
  return { services, employees, objectivesGeoById: map, tiposNovedad };
}

export async function ensureAnalisisFacts(opts: ScopeOpts & {
  requestedStart: Date;
  requestedEnd: Date;
  force?: boolean;
}): Promise<AnalisisMemoryStore> {
  const store = ensureStore(opts.empresaId);
  const empIds = new Set(store.employees.map((e: any) => e.id));
  const env = envelopingRange(opts.requestedStart, opts.requestedEnd);
  const requested: MsRange = { startMs: env.start.getTime(), endMs: env.end.getTime() };

  const gaps = opts.force ? [requested] : gapsToFetch(store.intervals, requested);

  if (opts.force) {
    store.turnos = store.turnos.filter((t) => {
      const ms = t.startTime?.seconds != null ? t.startTime.seconds * 1000 : null;
      if (ms == null) return true;
      return ms < requested.startMs || ms > requested.endMs;
    });
  }

  if (gaps.length) {
    const chunks = await Promise.all(gaps.map((g) => fetchTurnosRange(g, opts, empIds)));
    store.turnos = mergeDocsById(store.turnos, chunks.flat());
    store.intervals = mergeIntervals([...store.intervals, ...gaps]);
    store.factsAt = Date.now();
  }

  if (!store.ausenciasLoaded || opts.force) {
    store.ausencias = await fetchAusenciasAll(opts, empIds);
    store.ausenciasLoaded = true;
    store.factsAt = Date.now();
  }

  persistMeta(store);
  return store;
}

export function periodSliceFromStore(
  store: AnalisisMemoryStore | null,
  periodStart: Date,
  periodEnd: Date,
): { turnos: any[]; ausencias: any[] } {
  if (!store) return { turnos: [], ausencias: [] };
  return {
    turnos: filterTurnosInRange(store.turnos, periodStart, periodEnd),
    ausencias: filterAusenciasLoose(store.ausencias, periodStart),
  };
}

export function hydrateMetaHint(empresaId: string): AnalisisSnapMeta | null {
  const meta = readMeta();
  if (!meta || meta.empresaId !== empresaId) return null;
  return meta;
}
