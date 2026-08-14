import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import {
  type ObjectiveGeoEntry,
  isRangeCovered as intervalsCover,
} from '@/lib/analisis/analisisQueries';
import {
  type AnalisisMemoryStore,
  ensureAnalisisFacts,
  fetchAnalisisCatalog,
  getAnalisisMemoryStore,
  periodSliceFromStore,
  resetAnalisisMemoryStore,
  storeCoversRange,
} from '@/lib/analisis/analisisSnapshot';

export type UseAnalisisSnapshotArgs = {
  empresaId: string | undefined;
  loadingEmpresa: boolean;
  scopeEmpresa: boolean;
  migracionCompleta: boolean;
  periodStart: Date;
  periodEnd: Date;
};

export function useAnalisisSnapshot(args: UseAnalisisSnapshotArgs) {
  const { empresaId, loadingEmpresa, scopeEmpresa, migracionCompleta, periodStart, periodEnd } = args;
  const periodStartMs = periodStart.getTime();
  const periodEndMs = periodEnd.getTime();

  const [storeVersion, setStoreVersion] = useState(0);
  const [loadInit, setLoadInit] = useState(true);
  const [loadFacts, setLoadFacts] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const genRef = useRef(0);

  const bump = useCallback(() => setStoreVersion((v) => v + 1), []);

  const scopeOpts = useMemo(() => ({
    empresaId: String(empresaId || '').trim(),
    scopeEmpresa,
    migracionCompleta,
  }), [empresaId, scopeEmpresa, migracionCompleta]);

  useEffect(() => {
    if (loadingEmpresa) return;
    if (!scopeOpts.empresaId) {
      setLoadInit(false);
      setLoadError('No hay empresa activa en la sesión.');
      return;
    }
    const mem = getAnalisisMemoryStore();
    if (mem && mem.empresaId !== scopeOpts.empresaId) {
      resetAnalisisMemoryStore();
    }
    let cancelled = false;
    const gen = ++genRef.current;
    (async () => {
      try {
        setLoadError(null);
        const existing = getAnalisisMemoryStore();
        const needCatalog = !existing || existing.empresaId !== scopeOpts.empresaId || !existing.catalogAt;
        if (needCatalog) {
          setLoadInit(true);
          await fetchAnalisisCatalog(scopeOpts);
          if (cancelled || gen !== genRef.current) return;
          bump();
          setLoadInit(false);
        } else {
          setLoadInit(false);
        }
        if (cancelled || gen !== genRef.current) return;
        setLoadFacts(true);
        await ensureAnalisisFacts({
          ...scopeOpts,
          requestedStart: new Date(periodStartMs),
          requestedEnd: new Date(periodEndMs),
        });
        if (cancelled || gen !== genRef.current) return;
        bump();
      } catch (e) {
        console.error(e);
        if (!cancelled && gen === genRef.current) {
          setLoadError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo de Análisis.');
        }
      } finally {
        if (!cancelled && gen === genRef.current) {
          setLoadInit(false);
          setLoadFacts(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadingEmpresa, scopeOpts, periodStartMs, periodEndMs, bump]);

  const store: AnalisisMemoryStore | null = useMemo(() => {
    void storeVersion;
    const mem = getAnalisisMemoryStore();
    if (!mem || mem.empresaId !== scopeOpts.empresaId) return null;
    return mem;
  }, [storeVersion, scopeOpts.empresaId]);

  const services = store?.services ?? [];
  const employees = store?.employees ?? [];
  const objectivesGeoById: Record<string, ObjectiveGeoEntry> = store?.objectivesGeoById ?? {};
  const tiposNovedad: NovedadType[] = store?.tiposNovedad ?? [];
  const allTurnos = store?.turnos ?? [];
  const allAusencias = store?.ausencias ?? [];

  const { turnos, ausencias } = useMemo(
    () => periodSliceFromStore(store, new Date(periodStartMs), new Date(periodEndMs)),
    [store, periodStartMs, periodEndMs],
  );

  const ensureRange = useCallback(async (start: Date, end: Date) => {
    if (!scopeOpts.empresaId) return;
    if (storeCoversRange(getAnalisisMemoryStore(), start, end)) {
      bump();
      return;
    }
    setLoadFacts(true);
    try {
      await ensureAnalisisFacts({
        ...scopeOpts,
        requestedStart: start,
        requestedEnd: end,
      });
      bump();
    } catch (e) {
      console.error(e);
    } finally {
      setLoadFacts(false);
    }
  }, [scopeOpts, bump]);

  const reloadAll = useCallback(async () => {
    if (!scopeOpts.empresaId) return;
    setLoadInit(true);
    setLoadFacts(true);
    try {
      resetAnalisisMemoryStore();
      await fetchAnalisisCatalog(scopeOpts);
      await ensureAnalisisFacts({
        ...scopeOpts,
        requestedStart: new Date(periodStartMs),
        requestedEnd: new Date(periodEndMs),
        force: true,
      });
      bump();
    } catch (e) {
      console.error(e);
    } finally {
      setLoadInit(false);
      setLoadFacts(false);
    }
  }, [scopeOpts, periodStartMs, periodEndMs, bump]);

  const isRangeCovered = useCallback((start: Date, end: Date) => {
    const mem = getAnalisisMemoryStore();
    if (!mem || mem.empresaId !== scopeOpts.empresaId) return false;
    return intervalsCover(mem.intervals, { startMs: start.getTime(), endMs: end.getTime() });
  }, [scopeOpts.empresaId, storeVersion]);

  return {
    services,
    employees,
    turnos,
    ausencias,
    allTurnos,
    allAusencias,
    tiposNovedad,
    objectivesGeoById,
    loadInit,
    loadFacts,
    loadError,
    catalogAt: store?.catalogAt ?? null,
    factsAt: store?.factsAt ?? null,
    coveredIntervals: store?.intervals ?? [],
    ensureRange,
    reloadAll,
    isRangeCovered,
  };
}
