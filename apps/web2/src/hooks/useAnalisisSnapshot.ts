import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import {
  type ObjectiveGeoEntry,
  analisisWorkingWindow,
  envelopingRange,
  isRangeCovered as intervalsCover,
} from '@/lib/analisis/analisisQueries';
import {
  type AnalisisLoadProgress,
  type AnalisisMemoryStore,
  ensureAnalisisFacts,
  fetchAnalisisCatalog,
  getAnalisisMemoryStore,
  periodSliceFromStore,
  resetAnalisisMemoryStore,
  storeCoversRange,
} from '@/lib/analisis/analisisSnapshot';

export type { AnalisisLoadProgress };

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
  const [loadError, setLoadError] = useState(null as string | null);
  const [loadProgress, setLoadProgress] = useState(null as AnalisisLoadProgress | null);
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
    const win = analisisWorkingWindow(new Date());
    (async () => {
      try {
        setLoadError(null);
        const existing = getAnalisisMemoryStore();
        const windowCovered = storeCoversRange(
          existing && existing.empresaId === scopeOpts.empresaId ? existing : null,
          win.start,
          win.end,
        );
        const needCatalog = !existing || existing.empresaId !== scopeOpts.empresaId || !existing.catalogAt;
        if (needCatalog || !windowCovered) setLoadInit(true);
        else setLoadInit(false);
        if (needCatalog) {
          setLoadProgress({ pct: 4, label: 'Catálogo (SLA, plantel, clientes)', phase: 'catalog', docs: 0 });
          await fetchAnalisisCatalog(scopeOpts);
          if (cancelled || gen !== genRef.current) return;
          bump();
        }
        if (cancelled || gen !== genRef.current) return;
        if (!windowCovered) {
          setLoadFacts(true);
          await ensureAnalisisFacts({
            ...scopeOpts,
            requestedStart: win.start,
            requestedEnd: win.end,
            phase: 'malla',
            onProgress: (p) => {
              if (cancelled || gen !== genRef.current) return;
              setLoadProgress({
                ...p,
                pct: 8 + Math.round(p.pct * 0.9),
              });
            },
          });
        }
        if (cancelled || gen !== genRef.current) return;
        setLoadProgress({ pct: 100, label: 'Listo', phase: 'done', docs: getAnalisisMemoryStore()?.turnos.length || 0 });
        bump();
      } catch (e) {
        console.error(e);
        if (!cancelled && gen === genRef.current) {
          setLoadError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo de Análisis.');
        }
      } finally {
        if (!cancelled && gen === genRef.current) {
          setLoadFacts(false);
          const store = getAnalisisMemoryStore();
          const covered = storeCoversRange(
            store && store.empresaId === scopeOpts.empresaId ? store : null,
            win.start,
            win.end,
          );
          if (covered) setLoadInit(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadingEmpresa, scopeOpts, bump]);

  useEffect(() => {
    if (loadingEmpresa || loadInit || !scopeOpts.empresaId) return;
    const env = envelopingRange(new Date(periodStartMs), new Date(periodEndMs));
    if (storeCoversRange(getAnalisisMemoryStore(), env.start, env.end)) return;
    let cancelled = false;
    const gen = ++genRef.current;
    (async () => {
      setLoadFacts(true);
      setLoadError(null);
      try {
        await ensureAnalisisFacts({
          ...scopeOpts,
          requestedStart: env.start,
          requestedEnd: env.end,
          phase: 'malla',
          onProgress: (p) => {
            if (cancelled || gen !== genRef.current) return;
            setLoadProgress(p);
          },
        });
        if (!cancelled && gen === genRef.current) bump();
      } catch (e) {
        console.error(e);
        if (!cancelled && gen === genRef.current) {
          setLoadError(e instanceof Error ? e.message : 'No se pudo ampliar el rango de Análisis.');
        }
      } finally {
        if (!cancelled && gen === genRef.current) setLoadFacts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadingEmpresa, loadInit, scopeOpts, periodStartMs, periodEndMs, bump]);

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
        phase: 'malla',
        onProgress: (p) => setLoadProgress(p),
      });
      bump();
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : 'No se pudo ampliar el rango de Análisis.');
    } finally {
      setLoadFacts(false);
    }
  }, [scopeOpts, bump]);

  const reloadAll = useCallback(async () => {
    if (!scopeOpts.empresaId) return;
    const win = analisisWorkingWindow(new Date());
    setLoadInit(true);
    setLoadFacts(true);
    setLoadError(null);
    setLoadProgress({ pct: 2, label: 'Reiniciando snapshot…', phase: 'catalog', docs: 0 });
    try {
      resetAnalisisMemoryStore();
      setLoadProgress({ pct: 6, label: 'Catálogo (SLA, plantel, clientes)', phase: 'catalog', docs: 0 });
      await fetchAnalisisCatalog(scopeOpts);
      await ensureAnalisisFacts({
        ...scopeOpts,
        requestedStart: win.start,
        requestedEnd: win.end,
        force: true,
        phase: 'malla',
        onProgress: (p) => setLoadProgress({ ...p, pct: 10 + Math.round(p.pct * 0.88) }),
      });
      setLoadProgress({ pct: 100, label: 'Listo', phase: 'done', docs: getAnalisisMemoryStore()?.turnos.length || 0 });
      bump();
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : 'No se pudo recargar Análisis.');
    } finally {
      setLoadFacts(false);
      const mem = getAnalisisMemoryStore();
      const covered = storeCoversRange(
        mem && mem.empresaId === scopeOpts.empresaId ? mem : null,
        win.start,
        win.end,
      );
      if (covered) setLoadInit(false);
    }
  }, [scopeOpts, bump]);

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
    loadProgress,
    catalogAt: store?.catalogAt ?? null,
    factsAt: store?.factsAt ?? null,
    coveredIntervals: store?.intervals ?? [],
    ensureRange,
    reloadAll,
    isRangeCovered,
  };
}
