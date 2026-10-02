import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ObjectiveLocation } from '@cosp/portal-types';
import { loadObjectivesMapDetailed } from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';
import { usePortalAuth } from '../context/PortalAuthContext';

/**
 * Objetivos de las empresas del guardia (`objetivos` + `clients.objetivos[]` filtrados por
 * `empresaId`). Si la lectura falla, `error` queda en true y se loguea: la fichada resuelve el
 * objetivo del turno aparte, así que un mapa vacío nunca se interpreta como «sin ubicación».
 */
export function useObjectivesMap() {
  const { deviceVerified, employee, eventualLegajos } = usePortalAuth();
  const [objectivesMap, setObjectivesMap] = useState<Record<string, ObjectiveLocation>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const empresaKey = useMemo(() => {
    const ids = new Set<string>();
    const main = String(employee?.empresaId ?? '').trim();
    if (main) ids.add(main);
    for (const l of eventualLegajos ?? []) {
      const id = String(l.empresaId ?? '').trim();
      if (id) ids.add(id);
    }
    return Array.from(ids).sort().join('|');
  }, [employee?.empresaId, eventualLegajos]);

  useEffect(() => {
    if (deviceVerified !== true) {
      setObjectivesMap({});
      setError(false);
      setLoading(deviceVerified === null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { db } = getPortalFirebase();
        const empresaIds = empresaKey ? empresaKey.split('|') : [];
        const result = await loadObjectivesMapDetailed(db, { empresaIds });
        if (cancelled) return;
        setObjectivesMap(result.map);
        setError(result.error);
      } catch (e) {
        if (cancelled) return;
        console.warn('[useObjectivesMap]', e instanceof Error ? e.message : String(e));
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceVerified, empresaKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { objectivesMap, loading, error, reload };
}
