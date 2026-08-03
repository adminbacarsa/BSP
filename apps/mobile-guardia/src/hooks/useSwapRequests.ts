import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getPortalFirebase } from '../lib/portal';

export type SwapRequestRow = {
  id: string;
  status?: string;
  requesterId?: string;
  targetId?: string;
  requesterUid?: string;
  targetUid?: string;
  requesterName?: string;
  targetName?: string;
  requesterShiftDate?: string;
  targetShiftDate?: string;
  requesterObjectiveName?: string;
  targetObjectiveName?: string;
};

export function useSwapRequests(empDocId: string | null) {
  const { db } = getPortalFirebase();
  const [requests, setRequests] = useState<SwapRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!empDocId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const snap1 = await getDocs(
        query(collection(db, 'swap_requests'), where('requesterId', '==', empDocId)),
      );
      const snap2 = await getDocs(
        query(collection(db, 'swap_requests'), where('targetId', '==', empDocId)),
      );
      const all = [...snap1.docs, ...snap2.docs].map((d) => ({ id: d.id, ...(d.data() as object) })) as SwapRequestRow[];
      const unique = Array.from(new Map(all.map((r) => [r.id, r])).values());
      unique.sort((a, b) => String(b.requesterShiftDate || '').localeCompare(String(a.requesterShiftDate || '')));
      setRequests(unique);
    } catch (e) {
      console.warn('[useSwapRequests]', e);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [empDocId, db]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { requests, loading, reload };
}

export function swapStatusLabel(status: string | undefined): string {
  const s = (status || '').toUpperCase();
  switch (s) {
    case 'PENDING_PEER':
      return 'Espera respuesta del compañero';
    case 'PENDING_REQUESTER':
      return 'Espera tu confirmación';
    case 'PENDING_SUPERVISOR':
      return 'Pendiente supervisor';
    case 'APPROVED':
      return 'Autorizada';
    case 'REJECTED':
      return 'Rechazada';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return status || '—';
  }
}
