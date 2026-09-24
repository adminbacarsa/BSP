import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { getPortalCallables, getPortalFirebase } from '../lib/portal';
import { mapPortalCallableError } from '../lib/mapPortalCallableError';
import {
  isActiveCoberturaStatus,
  isLlegadaTardeConvocatoria,
  type ConvocatoriaCobertura,
} from '../lib/convocatoriasCobertura';
import { usePortalAuth } from '../context/PortalAuthContext';

function mergeById(lists: ConvocatoriaCobertura[][]): ConvocatoriaCobertura[] {
  const map = new Map<string, ConvocatoriaCobertura>();
  for (const list of lists) {
    for (const item of list) {
      map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => {
    const at = String(a.timeoutAt ?? a.createdAt ?? '');
    const bt = String(b.timeoutAt ?? b.createdAt ?? '');
    return at.localeCompare(bt);
  });
}

/**
 * Escucha convocatorias_cobertura del guardia (PENDING/ESCALATED).
 * Query por candidateEmployeeId y/o candidateUid; filtro de status en cliente
 * (evita índice compuesto). Si las rules bloquean la lectura, error queda en `error`.
 */
export function useConvocatoriasCobertura(
  empDocId: string | null,
  authUid: string | null | undefined,
) {
  const { db } = getPortalFirebase();
  const { deviceVerified } = usePortalAuth();
  const [items, setItems] = useState<ConvocatoriaCobertura[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    const emp = empDocId?.trim() || '';
    const uid = authUid?.trim() || '';
    if (deviceVerified !== true || (!emp && !uid)) {
      setItems([]);
      setLoading(deviceVerified === null && (!!emp || !!uid));
      setError(null);
      setPermissionDenied(false);
      return;
    }

    setLoading(true);
    setError(null);
    setPermissionDenied(false);

    const buckets: Record<string, ConvocatoriaCobertura[]> = {};
    let lastErr: string | null = null;
    let denied = false;

    const publish = () => {
      setItems(mergeById(Object.values(buckets)));
      setError(lastErr);
      setPermissionDenied(denied);
      setLoading(false);
    };

    const unsubs: Unsubscribe[] = [];

    const listen = (key: string, field: 'candidateEmployeeId' | 'candidateUid', value: string) => {
      buckets[key] = [];
      const q = query(collection(db, 'convocatorias_cobertura'), where(field, '==', value));
      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            buckets[key] = snap.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as ConvocatoriaCobertura,
            );
            lastErr = null;
            publish();
          },
          (err) => {
            const code = String((err as { code?: string })?.code || '');
            const msg = err.message || 'No se pudieron leer convocatorias de cobertura';
            if (code.includes('permission-denied') || /permission/i.test(msg)) {
              denied = true;
            }
            lastErr = msg;
            buckets[key] = [];
            publish();
          },
        ),
      );
    };

    if (emp) listen('emp', 'candidateEmployeeId', emp);
    if (uid && uid !== emp) listen('uid', 'candidateUid', uid);

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [db, empDocId, authUid, deviceVerified]);

  const active = useMemo(
    () => items.filter((c) => isActiveCoberturaStatus(c.status)),
    [items],
  );

  const coberturaPendientes = useMemo(
    () => active.filter((c) => !isLlegadaTardeConvocatoria(c)),
    [active],
  );

  const llegadaTardePendientes = useMemo(
    () => active.filter((c) => isLlegadaTardeConvocatoria(c)),
    [active],
  );

  const responder = useCallback(
    async (
      convocatoriaId: string,
      response: 'ACCEPTED' | 'REJECTED',
      opts?: { rejectionReason?: string; etaMinutes?: number },
    ): Promise<{ ok: true; message: string } | { ok: false; message: string }> => {
      setBusyId(convocatoriaId);
      try {
        const { responderConvocatoriaCobertura } = getPortalCallables();
        await responderConvocatoriaCobertura({
          convocatoriaId,
          response,
          rejectionReason: opts?.rejectionReason,
          etaMinutes: opts?.etaMinutes,
        });
        return {
          ok: true,
          message:
            response === 'ACCEPTED'
              ? 'Convocatoria aceptada'
              : 'Respuesta enviada',
        };
      } catch (e) {
        return { ok: false, message: mapPortalCallableError(e) };
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return {
    coberturaPendientes,
    llegadaTardePendientes,
    busyId,
    loading,
    error,
    permissionDenied,
    responder,
  };
}
