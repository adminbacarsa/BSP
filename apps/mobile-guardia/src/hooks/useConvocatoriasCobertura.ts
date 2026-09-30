import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { getPortalFirebase } from '../lib/portal';
import { mapPortalCallableError } from '../lib/mapPortalCallableError';
import { respondCoberturaConvocatoria } from '../lib/respondCoberturaConvocatoria';
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
  const { deviceVerified, eventualLegajos, isPreviewMode, isEventual } = usePortalAuth();
  const eventualKeys = eventualLegajos.map((l) => l.employeeId).join('|');
  const [items, setItems] = useState<ConvocatoriaCobertura[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    const emp = empDocId?.trim() || '';
    const uid = isPreviewMode && isEventual ? '' : authUid?.trim() || '';
    const extras = eventualKeys.split('|').map((k) => k.trim()).filter((k) => k && k !== emp && k !== uid);
    if (deviceVerified !== true || (!emp && !uid && extras.length === 0)) {
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
    for (const extra of extras) listen(`emp:${extra}`, 'candidateEmployeeId', extra);

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [db, empDocId, authUid, deviceVerified, eventualKeys, isPreviewMode, isEventual]);

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

  const aceptadas = useMemo(
    () => items.filter((c) => String(c.status || '').toUpperCase() === 'ACCEPTED'),
    [items],
  );

  const responder = useCallback(
    async (
      convocatoriaId: string,
      response: 'ACCEPTED' | 'REJECTED',
      opts?: { rejectionReason?: string; etaMinutes?: number },
    ): Promise<{ ok: true; message: string } | { ok: false; message: string }> => {
      setBusyId(convocatoriaId);
      try {
        const asEmployeeId = isPreviewMode
          ? String(items.find((c) => c.id === convocatoriaId)?.candidateEmployeeId || '').trim()
          : '';
        const result = await respondCoberturaConvocatoria({
          convocatoriaId,
          response,
          responseChannel: 'BANNER_HOY',
          rejectionReason: opts?.rejectionReason,
          etaMinutes: opts?.etaMinutes,
          ...(asEmployeeId ? { asEmployeeId } : {}),
        });
        if (result.ok) return { ok: true, message: result.message };
        return { ok: false, message: result.message };
      } catch (e) {
        return { ok: false, message: mapPortalCallableError(e) };
      } finally {
        setBusyId(null);
      }
    },
    [isPreviewMode, items],
  );

  return {
    coberturaPendientes,
    llegadaTardePendientes,
    aceptadas,
    busyId,
    loading,
    error,
    permissionDenied,
    responder,
  };
}
