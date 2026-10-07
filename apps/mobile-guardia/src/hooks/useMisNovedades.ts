import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, type Query } from 'firebase/firestore';
import { clavesDeLectura, ordenarNovedades, type NovedadComoDoc } from '@cosp/portal-core';
import { usePortalAuth } from '../context/PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';

export type NovedadMia = NovedadComoDoc & { id: string };

/**
 * Ausencias propias y las que cargó RRHH. Nómina: uid + legajo.
 * Eventual: cada legajo + bolsaCuil. Vista previa: no consulta el uid del SuperAdmin.
 */
export function useMisNovedades() {
  const { user, empDocId, bolsaCuil, eventualLegajos, isPreviewMode } = usePortalAuth();
  const { db } = getPortalFirebase();
  const legajoKey = eventualLegajos.map((row) => row.employeeId).join('|');
  const claves = useMemo(
    () =>
      clavesDeLectura({
        uid: user?.uid,
        empDocId,
        legajoIds: legajoKey ? legajoKey.split('|') : [],
        bolsaCuil,
        preview: isPreviewMode,
      }),
    [user?.uid, empDocId, legajoKey, bolsaCuil, isPreviewMode],
  );
  const [rows, setRows] = useState<NovedadMia[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    const consultas: Array<{ key: string; q: Query }> = claves.employeeIds.map((id) => ({
      key: `emp:${id}`,
      q: query(collection(db, 'ausencias'), where('employeeId', '==', id)),
    }));
    if (claves.bolsaCuil) {
      consultas.push({
        key: `cuil:${claves.bolsaCuil}`,
        q: query(collection(db, 'ausencias'), where('bolsaCuil', '==', claves.bolsaCuil)),
      });
    }
    if (consultas.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    const buckets = new Map<string, Map<string, NovedadMia>>();
    const listos = new Set<string>();
    const publicar = () => {
      const merged = new Map<string, NovedadMia>();
      for (const bucket of buckets.values()) {
        for (const [id, row] of bucket) merged.set(id, row);
      }
      setRows(ordenarNovedades([...merged.values()]));
      if (listos.size >= consultas.length) setLoading(false);
    };
    const unsubs = consultas.map(({ key, q }) =>
      onSnapshot(
        q,
        (snap) => {
          const bucket = new Map<string, NovedadMia>();
          snap.forEach((docSnap) => {
            bucket.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as NovedadComoDoc) });
          });
          buckets.set(key, bucket);
          listos.add(key);
          publicar();
        },
        () => {
          buckets.set(key, new Map());
          listos.add(key);
          publicar();
        },
      ),
    );
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [user, db, claves]);

  return { rows, loading };
}
