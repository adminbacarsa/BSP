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

export type PortalInboxItem = PortalInboxNormalized;

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
export function usePortalInbox(user: User | null, previewEmpDocId?: string | null) {
  const { db } = getPortalFirebase();
  const [items, setItems] = useState<PortalInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const bucketsRef = useRef<Record<string, PortalInboxItem[]>>({});
  const fallbackRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      bucketsRef.current = {};
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    bucketsRef.current = {};
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

    const registerEmp = (empId: string) => {
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

    // Preview: solo legajo (evita vacantes/ops del SuperAdmin).
    if (previewId) {
      registerEmp(previewId);
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
  }, [user?.uid, previewEmpDocId, db]);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read || alertNeedsAck(n)).length,
    [items],
  );

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
    markRead,
    acknowledge,
    dismiss,
    markAllUnreadRead,
    dismissAll,
  };
}
