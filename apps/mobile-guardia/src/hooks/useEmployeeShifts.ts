import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
  type Query,
} from 'firebase/firestore';
import type { Shift } from '@cosp/portal-types';
import { getPortalFirebase } from '../lib/portal';
import { sortShiftsByStart } from '../lib/shifts';

function monthRange(anchor: Date) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function buildMonthQuery(employeeKey: string, anchor: Date): Query {
  const { start, end } = monthRange(anchor);
  const { db } = getPortalFirebase();
  return query(
    collection(db, 'turnos'),
    where('employeeId', '==', employeeKey),
    where('startTime', '>=', Timestamp.fromDate(start)),
    where('startTime', '<=', Timestamp.fromDate(end)),
  );
}

function mergeShiftLists(lists: Shift[][]): Shift[] {
  const map = new Map<string, Shift>();
  for (const list of lists) {
    for (const s of list) {
      map.set(s.id, s);
    }
  }
  return sortShiftsByStart([...map.values()]);
}

export function useEmployeeShifts(
  empDocId: string | null,
  authUid: string | null,
  monthAnchor: Date = new Date(),
) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const employeeKeys = useMemo(() => {
    const keys = new Set<string>();
    if (empDocId?.trim()) keys.add(empDocId.trim());
    if (authUid?.trim()) keys.add(authUid.trim());
    return [...keys];
  }, [empDocId, authUid]);

  const monthKey = `${monthAnchor.getFullYear()}-${monthAnchor.getMonth()}`;

  useEffect(() => {
    if (employeeKeys.length === 0) {
      setShifts([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const buckets: Record<string, Shift[]> = {};
    let errorMessage: string | null = null;
    const anchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);

    const publish = () => {
      const lists = employeeKeys.map((k) => buckets[k] ?? []);
      setShifts(mergeShiftLists(lists));
      setError(errorMessage);
      setLoading(false);
    };

    const unsubs = employeeKeys.map((key) => {
      const q = buildMonthQuery(key, anchor);
      return onSnapshot(
        q,
        (snap) => {
          buckets[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
          publish();
        },
        (err) => {
          if (!errorMessage) {
            errorMessage = err.message || 'Error cargando turnos';
          }
          buckets[key] = [];
          publish();
        },
      );
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [employeeKeys.join('|'), monthKey]);

  return { shifts, loading, error, hasEmployeeKey: employeeKeys.length > 0 };
}
