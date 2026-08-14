/**
 * Snapshot de Análisis: catálogo (1× empresa) + hechos con merge de rango.
 * Los turnos NO se persisten en sessionStorage (pueden ser ~18k docs).
 */

import { collection, getDocs, onSnapshot, query, type Query, type QuerySnapshot } from 'firebase/firestore';
import { db, getDocsOnce } from '@/lib/firebase';
import {
  belongsToEmpresaView,
  empresaCollectionQuery,
  filterRowsByEmpresa,
} from '@/lib/multiempresa';
import { buildPlanningMonthTurnosQuery, planningMonthBounds } from '@/lib/planificacion/loadPlanningMonthShifts';
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
  shiftStartMs,
  monthsInRange,
} from './analisisQueries';

const META_KEY = 'cosp:analisis:snap-meta';
/** Sube si cambia la semántica de fetch (invalida store en memoria envenenado con 0 turnos). */
const SNAPSHOT_GEN = 5;
const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

export type AnalisisLoadProgress = {
  pct: number;
  label: string;
  phase: 'catalog' | 'malla' | 'lookback' | 'ausencias' | 'done';
  docs: number;
};

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
  snapGen: number;
};

let memoryStore: AnalisisMemoryStore | null = null;
let loadEpoch = 0;
const turnosMonthInflight = new Map<string, Promise<any[]>>();

function readMeta(): AnalisisSnapMeta | null {
  return readSessionJson<AnalisisSnapMeta>(META_KEY);
}

function writeMeta(meta: AnalisisSnapMeta) {
  writeSessionJson(META_KEY, meta);
}

export function getAnalisisMemoryStore(): AnalisisMemoryStore | null {
  if (memoryStore && memoryStore.snapGen !== SNAPSHOT_GEN) {
    memoryStore = null;
  }
  return memoryStore;
}

export function resetAnalisisMemoryStore() {
  loadEpoch += 1;
  turnosMonthInflight.clear();
  ausenciasInflight = null;
  memoryStore = null;
}

function ensureStore(empresaId: string): AnalisisMemoryStore {
  if (!memoryStore || memoryStore.empresaId !== empresaId || memoryStore.snapGen !== SNAPSHOT_GEN) {
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
      snapGen: SNAPSHOT_GEN,
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

/**
 * Lectura de malla.
 * Producción: getDocs (una ida al servidor). Nunca cortar con cache vacío.
 * Emulador: onSnapshot — getDocs con longPolling se cuelga; el 1.er fromCache vacío
 * es miss, el 2.º (con docs o vacío real) es el listen.
 */
function getDocsMalla<T = any>(q: Query<T>): Promise<QuerySnapshot<T>> {
  if (!USE_EMULATOR) {
    return getDocs(q);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let n = 0;
    const done = (snap?: QuerySnapshot<T>, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsub(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(snap as QuerySnapshot<T>);
    };
    const timer = setTimeout(() => {
      done(undefined, new Error('Timeout leyendo malla (90s). Probá Recargar.'));
    }, 90_000);
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        n += 1;
        if (!snap.metadata.fromCache) {
          done(snap);
          return;
        }
        if (!snap.empty) {
          done(snap);
          return;
        }
        if (n >= 2) done(snap);
      },
      (err) => done(undefined, err),
    );
  });
}

function mapTurnoDocs(
  docs: Array<{ id: string; data: () => any }>,
  opts: ScopeOpts,
): any[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t: any) => {
      if (t.isDeleted === true) return false;
      if (String(t.type || '').toUpperCase() === 'NOVEDAD') return false;
      const hasClock = !!(t.startTime || t.date || t.scheduleDate || t.planningDate || t.fecha);
      if (!hasClock) return false;
      if (!belongsToEmpresaView(t, opts.empresaId, opts.migracionCompleta)) return false;
      return true;
    });
}

async function fetchTurnosMonthOnce(year: number, month: number, opts: ScopeOpts): Promise<any[]> {
  const q = buildPlanningMonthTurnosQuery({
    empresaId: opts.empresaId,
    scopeEmpresa: opts.scopeEmpresa,
    year,
    month,
  });
  const snap = await getDocsMalla(q);
  const mapped = mapTurnoDocs(snap.docs, opts);
  if (snap.size > 0 && mapped.length === 0) {
    console.warn(`[analisis] ${year}-${String(month).padStart(2, '0')}: ${snap.size} turnos en Firestore, 0 tras filtro empresa/tipo`);
  }
  return mapped;
}

async function fetchTurnosMonth(year: number, month: number, opts: ScopeOpts): Promise<any[]> {
  const key = `${opts.empresaId}:${year}-${String(month).padStart(2, '0')}`;
  const hit = turnosMonthInflight.get(key);
  if (hit) return hit;
  const p = fetchTurnosMonthOnce(year, month, opts).finally(() => {
    turnosMonthInflight.delete(key);
  });
  turnosMonthInflight.set(key, p);
  return p;
}

let ausenciasInflight: Promise<any[]> | null = null;

async function fetchAusenciasAll(opts: ScopeOpts): Promise<any[]> {
  if (ausenciasInflight) return ausenciasInflight;
  ausenciasInflight = (async () => {
    const snap = await getDocsOnce(
      empresaCollectionQuery('ausencias', opts.empresaId, opts.scopeEmpresa) as ReturnType<typeof query>,
    );
    return filterRowsByEmpresa(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      opts.empresaId,
      opts.scopeEmpresa,
      opts.migracionCompleta,
    );
  })().finally(() => {
    ausenciasInflight = null;
  });
  return ausenciasInflight;
}

export async function fetchAnalisisCatalog(opts: ScopeOpts): Promise<{
  services: any[];
  employees: any[];
  objectivesGeoById: Record<string, ObjectiveGeoEntry>;
  tiposNovedad: NovedadType[];
}> {
  const { empresaId, scopeEmpresa, migracionCompleta } = opts;
  const [sSnap, eSnap] = await Promise.all([
    getDocsOnce(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>),
    getDocsOnce(empresaCollectionQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>),
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
    const snap = await getDocsOnce(collection(db, 'objetivos'));
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
    const clientsSnap = await getDocsOnce(
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
    const tSnap = await getDocsOnce(
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
  phase?: 'malla' | 'lookback';
  onProgress?: (p: AnalisisLoadProgress) => void;
}): Promise<AnalisisMemoryStore> {
  const store = ensureStore(opts.empresaId);
  const env = envelopingRange(opts.requestedStart, opts.requestedEnd);
  const requested: MsRange = { startMs: env.start.getTime(), endMs: env.end.getTime() };
  const phase = opts.phase || 'malla';

  const gaps = opts.force ? [requested] : gapsToFetch(store.intervals, requested);

  if (opts.force) {
    store.turnos = store.turnos.filter((t) => {
      const ms = shiftStartMs(t);
      if (ms == null) return true;
      return ms < requested.startMs || ms > requested.endMs;
    });
  }

  const months = gaps.flatMap((g) => monthsInRange(g));
  const totalSteps = Math.max(1, months.length);
  const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const epoch = loadEpoch;

  const ausenciasP = (!store.ausenciasLoaded || opts.force)
    ? fetchAusenciasAll(opts)
    : Promise.resolve(null as any[] | null);

  if (months.length) {
    opts.onProgress?.({
      phase,
      pct: 4,
      label: months.length === 1
        ? `Malla ${MONTHS_SHORT[months[0].month - 1]} ${months[0].year}`
        : `Malla ${months.length} meses en paralelo`,
      docs: store.turnos.length,
    });
    let done = 0;
    await Promise.all(months.map(async ({ year, month }) => {
      const docs = await fetchTurnosMonth(year, month, opts);
      if (epoch !== loadEpoch) return;
      store.turnos = mergeDocsById(store.turnos, docs);
      const bounds = planningMonthBounds(year, month);
      store.intervals = mergeIntervals([
        ...store.intervals,
        { startMs: bounds.firstDay.getTime(), endMs: bounds.lastDay.getTime() },
      ]);
      store.factsAt = Date.now();
      persistMeta(store);
      done += 1;
      opts.onProgress?.({
        phase,
        pct: Math.min(95, Math.round((done / totalSteps) * 90) + 4),
        label: `Malla ${MONTHS_SHORT[month - 1]} ${year}`,
        docs: store.turnos.length,
      });
    }));
    if (epoch !== loadEpoch) return ensureStore(opts.empresaId);
  }

  if (!store.ausenciasLoaded || opts.force) {
    opts.onProgress?.({
      phase: 'ausencias',
      pct: 96,
      label: 'Ausencias RRHH',
      docs: store.turnos.length,
    });
    store.ausencias = (await ausenciasP) || [];
    if (epoch !== loadEpoch) return ensureStore(opts.empresaId);
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
