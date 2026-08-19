import { useEffect, useMemo, useState } from 'react';
import type { Evento } from '@cosp/portal-types';
import { eventosArrayToMap, loadEventosByEmpresaRange, portalEventosDateRange } from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';

export function useEventosMap(empresaId: string | undefined) {
  const { db } = getPortalFirebase();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!empresaId) {
      setEventos([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const { from, to } = portalEventosDateRange();
    loadEventosByEmpresaRange(db, empresaId, from, to)
      .then((evs) => {
        if (!cancelled) setEventos(evs);
      })
      .catch(() => {
        if (!cancelled) setEventos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [db, empresaId]);

  const eventosMap = useMemo(() => eventosArrayToMap(eventos), [eventos]);

  return { eventos, eventosMap, loading };
}
