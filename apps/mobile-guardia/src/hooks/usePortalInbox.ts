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

export type PortalInboxItem = PortalInboxNormalized;

function mergeInboxBuckets(buckets: Record<string, PortalInboxItem[]>): PortalInboxItem[] {
  const merged = Object.values(buckets).flat();
  const unique = Array.from(new Map(merged.map((n) => [n.id, n])).values());
  unique.sort((a, b) => {
    const ad = inboxTimestampMs(a.createdAt);
    const bd = inboxTimestampMs(b.createdAt);
    return bd - ad;
  });
  return unique.slice(0, 20);
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

export function usePortalInbox(user: User | null) {
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

    register(
      `uid:${user.uid}`,
      query(
        collection(db, 'user_notifications'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(20),
      ),
      () => query(collection(db, 'user_notifications'), where('uid', '==', user.uid), limit(20)),
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
        ids.forEach((empId) => {
          register(
            `emp:${empId}`,
            query(
              collection(db, 'user_notifications'),
              where('employeeId', '==', empId),
              orderBy('createdAt', 'desc'),
              limit(20),
            ),
            () =>
              query(
                collection(db, 'user_notifications'),
                where('employeeId', '==', empId),
                limit(20),
              ),
          );
        });
      } catch (e) {
        console.warn('[usePortalInbox] empleados', e);
      }
    })();

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user?.uid, db]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const markRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), {
        read: true,
        readAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[usePortalInbox] markRead', e);
    }
  };

  const markAllUnreadRead = async () => {
    const unread = items.filter((n) => !n.read);
    await Promise.all(unread.map((n) => markRead(n.id)));
  };

  return { items, loading, unreadCount, markRead, markAllUnreadRead };
}
