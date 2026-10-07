import { useEffect, useMemo, useState } from 'react';
import { collection, limit, query, where } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { esPorRevisar } from '@/lib/rrhh/avisoPortal.mjs';

export type AusenciaPorRevisar = { id: string; [key: string]: unknown };

/**
 * Ausencias que RRHH tiene que mirar: avisos del portal sin revisar y
 * certificados en verificación. Las tres consultas usan índices que ya existen
 * (igualdad simple, o empresa + source + status de la campana).
 */
export function useAusenciasPorRevisar(empresaId: string | null | undefined): { count: number; filas: AusenciaPorRevisar[] } {
  const [pendientes, setPendientes] = useState<AusenciaPorRevisar[]>([]);
  const [revision, setRevision] = useState<AusenciaPorRevisar[]>([]);
  const [verificacion, setVerificacion] = useState<AusenciaPorRevisar[]>([]);

  useEffect(() => {
    if (!empresaId) {
      setPendientes([]);
      return;
    }
    const unsub = onSnapshotFresh(
      query(
        collection(db, 'ausencias'),
        where('empresaId', '==', empresaId),
        where('source', '==', 'EMPLEADO'),
        where('status', '==', 'Pendiente'),
        limit(50),
      ),
      (snap) => {
        setPendientes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AusenciaPorRevisar));
      },
      () => setPendientes([]),
    );
    return () => unsub();
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId) {
      setRevision([]);
      return;
    }
    const unsub = onSnapshotFresh(
      query(collection(db, 'ausencias'), where('revisionEstado', '==', 'POR_REVISAR'), limit(80)),
      (snap) => {
        setRevision(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as AusenciaPorRevisar)
            .filter((row) => String(row.empresaId || '') === empresaId),
        );
      },
      () => setRevision([]),
    );
    return () => unsub();
  }, [empresaId]);

  useEffect(() => {
    if (!empresaId) {
      setVerificacion([]);
      return;
    }
    const unsub = onSnapshotFresh(
      query(collection(db, 'ausencias'), where('status', '==', 'En verificación'), limit(80)),
      (snap) => {
        setVerificacion(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as AusenciaPorRevisar)
            .filter((row) => String(row.empresaId || '') === empresaId),
        );
      },
      () => setVerificacion([]),
    );
    return () => unsub();
  }, [empresaId]);

  return useMemo(() => {
    const byId = new Map<string, AusenciaPorRevisar>();
    for (const row of [...pendientes, ...revision, ...verificacion]) {
      if (esPorRevisar(row)) byId.set(row.id, row);
    }
    const filas = [...byId.values()];
    return { count: filas.length, filas };
  }, [pendientes, revision, verificacion]);
}
