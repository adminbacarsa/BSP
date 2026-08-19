import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { SolicitudEvento } from '@cosp/portal-types';
import { portalEventosDateRange } from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';

export function useConvocatoriasPendientes(empresaId: string | undefined, empDocId: string | null) {
  const { db } = getPortalFirebase();
  const [solicitudes, setSolicitudes] = useState<SolicitudEvento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaId || !empDocId) {
      setSolicitudes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { from, to } = portalEventosDateRange();
    const q = query(
      collection(db, 'solicitudes_evento'),
      where('empresaId', '==', empresaId),
      where('empleadoId', '==', empDocId),
      where('servicioFecha', '>=', from),
      where('servicioFecha', '<=', to),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setSolicitudes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SolicitudEvento));
        setLoading(false);
      },
      () => {
        setSolicitudes([]);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [db, empresaId, empDocId]);

  const convocatoriasPendientes = useMemo(
    () => solicitudes.filter((s) => s.tipo === 'admin_convoca' && s.status === 'convocado'),
    [solicitudes],
  );

  return { convocatoriasPendientes, loading };
}
