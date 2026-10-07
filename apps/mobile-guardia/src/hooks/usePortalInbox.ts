import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Query,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { normalizePortalInboxItem, type PortalInboxNormalized } from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';
import { isEmployeeFacingAlert, alertNeedsAck } from '../lib/notificationNavigation';
import { alertaCuentaSinLeer, type AlertaConvocatoriaVista } from '../lib/alertaCardState';
import { notifRetencionEsHistorial } from '../lib/retencionTarjeta';
import { usePortalAuth } from '../context/PortalAuthContext';

export type PortalInboxItem = PortalInboxNormalized;

/** Doc de `convocatorias_cobertura` visto desde la bandeja: estado + lugar/horario para la tarjeta. */
export type InboxConvocatoriaVista = AlertaConvocatoriaVista & {
  id?: string;
  shiftId?: string;
  objectiveId?: string;
  objectiveName?: string;
  positionName?: string;
  clientName?: string;
  shiftCode?: string;
  startTime?: unknown;
  candidateEmployeeName?: string;
};

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function mergeInboxBuckets(buckets: Record<string, PortalInboxItem[]>): PortalInboxItem[] {
  const merged = Object.values(buckets).flat();
  const unique = Array.from(new Map(merged.map((n) => [n.id, n])).values());
  const visible = unique.filter((n) =>
    isEmployeeFacingAlert({
      type: n.type,
      target: n.target,
      dismissed: n.dismissed,
      status: n.status,
    }),
  );
  visible.sort((a, b) => {
    const ad = inboxTimestampMs(a.createdAt);
    const bd = inboxTimestampMs(b.createdAt);
    return bd - ad;
  });
  return visible.slice(0, 40);
}

function inboxTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const ms = (value as { toMillis?: () => number }).toMillis?.();
    if (typeof ms === 'number') return ms;
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const sec = (value as { seconds?: number }).seconds;
    if (typeof sec === 'number') return sec * 1000;
  }
  return 0;
}

/**
 * @param previewEmpDocId En preview SuperAdmin solo escuchamos ese legajo
 * (no el uid del admin, que trae alertas de Operaciones).
 */
export function usePortalInbox(
  user: User | null,
  previewEmpDocId?: string | null,
  opts?: { shifts?: { id?: string }[] | null; shiftsReady?: boolean },
) {
  const { db } = getPortalFirebase();
  const { deviceVerified, isPreviewMode, isEventual, eventualLegajos } = usePortalAuth();
  const previewLegajosKey =
    isPreviewMode && isEventual ? eventualLegajos.map((l) => l.employeeId).join('|') : '';
  const [items, setItems] = useState<PortalInboxItem[]>([]);
  const [coberturaById, setCoberturaById] = useState<Record<string, InboxConvocatoriaVista>>({});
  const [loading, setLoading] = useState(true);
  const bucketsRef = useRef<Record<string, PortalInboxItem[]>>({});
  const convBucketsRef = useRef<Record<string, Array<InboxConvocatoriaVista & { id: string }>>>({});
  const fallbackRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || deviceVerified !== true) {
      bucketsRef.current = {};
      convBucketsRef.current = {};
      setItems([]);
      setCoberturaById({});
      setLoading(deviceVerified === null && !!user);
      return;
    }

    setLoading(true);
    bucketsRef.current = {};
    convBucketsRef.current = {};
    fallbackRef.current = new Set();
    const unsubs: Array<() => void> = [];
    const previewId = previewEmpDocId?.trim() || null;

    const rebuild = () => {
      setItems(mergeInboxBuckets(bucketsRef.current));
      setLoading(false);
    };

    const register = (key: string, q: Query, fallback?: () => Query) => {
      const unsub = onSnapshot(
        q,
        (snap) => {
          bucketsRef.current[key] = snap.docs.map((d) =>
            normalizePortalInboxItem(d.id, d.data() as Record<string, unknown>),
          );
          rebuild();
        },
        (err) => {
          const message = `${(err as { code?: string }).code ?? ''} ${(err as Error).message ?? ''}`.toLowerCase();
          const needsIndex =
            message.includes('requires an index') || message.includes('failed-precondition');
          if (fallback && needsIndex && !fallbackRef.current.has(key)) {
            fallbackRef.current.add(key);
            unsub();
            register(key, fallback());
            return;
          }
          console.warn('[usePortalInbox]', err);
          setLoading(false);
        },
      );
      unsubs.push(unsub);
    };

    const publishConv = () => {
      const map: Record<string, InboxConvocatoriaVista> = {};
      for (const list of Object.values(convBucketsRef.current)) {
        for (const row of list) map[row.id] = row;
      }
      setCoberturaById(map);
    };

    const listenConv = (key: string, field: 'candidateEmployeeId' | 'candidateUid', value: string) => {
      const unsub = onSnapshot(
        query(collection(db, 'convocatorias_cobertura'), where(field, '==', value)),
        (snap) => {
          convBucketsRef.current[key] = snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              status: typeof data.status === 'string' ? data.status : undefined,
              type: typeof data.type === 'string' ? data.type : undefined,
              timeoutAt: data.timeoutAt,
              endTime: data.endTime,
              cancelReason: typeof data.cancelReason === 'string' ? data.cancelReason : undefined,
              respondedAt: data.respondedAt,
              cancelledAt: data.cancelledAt,
              candidateEmployeeId:
                typeof data.candidateEmployeeId === 'string' ? data.candidateEmployeeId : undefined,
              shiftId: optStr(data.shiftId),
              objectiveId: optStr(data.objectiveId),
              objectiveName: optStr(data.objectiveName),
              positionName: optStr(data.positionName),
              clientName: optStr(data.clientName),
              shiftCode: optStr(data.shiftCode),
              startTime: data.startTime,
              candidateEmployeeName: optStr(data.candidateEmployeeName),
            };
          });
          publishConv();
        },
        (err) => {
          console.warn('[usePortalInbox] convocatorias', err);
          convBucketsRef.current[key] = [];
          publishConv();
        },
      );
      unsubs.push(unsub);
    };

    const registerEmp = (empId: string) => {
      listenConv(`conv-emp:${empId}`, 'candidateEmployeeId', empId);
      register(
        `emp:${empId}`,
        query(
          collection(db, 'user_notifications'),
          where('employeeId', '==', empId),
          orderBy('createdAt', 'desc'),
          limit(40),
        ),
        () =>
          query(collection(db, 'user_notifications'), where('employeeId', '==', empId), limit(40)),
      );
    };

    // Preview: solo el legajo (o todos los de la bolsa). No el uid del SuperAdmin.
    if (previewId || previewLegajosKey) {
      const ids = new Set<string>();
      if (previewId) ids.add(previewId);
      for (const id of previewLegajosKey.split('|')) if (id.trim()) ids.add(id.trim());
      ids.forEach((id) => registerEmp(id));
      if (!previewLegajosKey) listenConv(`conv-uid:${user.uid}`, 'candidateUid', user.uid);
      return () => {
        unsubs.forEach((u) => u());
      };
    }

    register(
      `uid:${user.uid}`,
      query(
        collection(db, 'user_notifications'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(40),
      ),
      () => query(collection(db, 'user_notifications'), where('uid', '==', user.uid), limit(40)),
    );
    listenConv(`conv-uid:${user.uid}`, 'candidateUid', user.uid);

    (async () => {
      try {
        const ids = new Set<string>();
        const byId = await getDoc(doc(db, 'empleados', user.uid));
        if (byId.exists()) ids.add(byId.id);
        const byUid = await getDocs(query(collection(db, 'empleados'), where('uid', '==', user.uid)));
        byUid.docs.forEach((d) => ids.add(d.id));
        if (user.email) {
          const email = user.email.trim();
          const byEmail = await getDocs(
            query(collection(db, 'empleados'), where('email', '==', email)),
          );
          byEmail.docs.forEach((d) => ids.add(d.id));
        }
        ids.forEach((empId) => registerEmp(empId));
      } catch (e) {
        console.warn('[usePortalInbox] empleados', e);
      }
    })();

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user?.uid, previewEmpDocId, previewLegajosKey, db, deviceVerified]);

  const unreadCount = useMemo(() => {
    const nowMs = Date.now();
    const shifts = opts?.shiftsReady ? (opts.shifts ?? []) : null;
    return items.filter((n) => {
      if (notifRetencionEsHistorial(n, shifts, nowMs)) return false;
      return alertaCuentaSinLeer({
        type: n.type,
        read: n.read,
        needsAck: alertNeedsAck(n),
        ackedAt: n.ackedAt,
        response: n.response,
        respondedAt: n.respondedAt,
        endTime: n.endTime,
        timeoutAt: n.timeoutAt,
        closedAt: n.closedAt,
        closedMotivo: n.closedMotivo,
        conv: n.convocatoriaId ? coberturaById[n.convocatoriaId] : null,
        nowMs,
      });
    }).length;
  }, [items, coberturaById, opts?.shifts, opts?.shiftsReady]);

  const markRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), {
        read: true,
        readAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[usePortalInbox] markRead', e);
      throw e;
    }
  };

  const acknowledge = async (id: string) => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), {
        read: true,
        readAt: serverTimestamp(),
        ackedAt: serverTimestamp(),
        ackedByUid: user?.uid || null,
      });
    } catch (e) {
      console.warn('[usePortalInbox] acknowledge', e);
      throw e;
    }
  };

  /** Escribe la respuesta del guardia a una convocatoria de cobertura. */
  const respond = async (id: string, response: 'ACCEPTED' | 'REJECTED') => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), {
        response,
        respondedAt: serverTimestamp(),
        read: true,
        readAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[usePortalInbox] respond', e);
      throw e;
    }
  };

  /** Soft-delete: el vigilador no puede deleteDoc (reglas); se oculta con dismissed. */
  const dismiss = async (id: string) => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), {
        dismissed: true,
        status: 'INACTIVE',
        read: true,
        readAt: serverTimestamp(),
        dismissedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[usePortalInbox] dismiss', e);
      throw e;
    }
  };

  const markAllUnreadRead = async () => {
    const pending = items.filter((n) => !n.read || alertNeedsAck(n));
    if (pending.length === 0) return;

    const errors: string[] = [];
    // Secuencial: evita saturar reglas/get() y deja trazas claras
    for (const n of pending) {
      try {
        if (alertNeedsAck(n)) {
          await acknowledge(n.id);
        } else {
          await markRead(n.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(n.id);
        console.warn('[usePortalInbox] markAllUnreadRead', n.id, msg);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `No se pudieron actualizar ${errors.length} de ${pending.length} alertas.`,
      );
    }
  };

  /** Soft-delete de toda la bandeja visible (mismas reglas que dismiss unitario). */
  const dismissAll = async () => {
    const pending = [...items];
    if (pending.length === 0) return;

    const errors: string[] = [];
    for (const n of pending) {
      try {
        if (alertNeedsAck(n)) {
          await acknowledge(n.id);
        }
        await dismiss(n.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(n.id);
        console.warn('[usePortalInbox] dismissAll', n.id, msg);
      }
    }
    if (errors.length > 0) {
      throw new Error(`No se pudieron quitar ${errors.length} de ${pending.length} alertas.`);
    }
  };

  return {
    items,
    loading,
    unreadCount,
    coberturaById,
    markRead,
    acknowledge,
    respond,
    dismiss,
    markAllUnreadRead,
    dismissAll,
  };
}
