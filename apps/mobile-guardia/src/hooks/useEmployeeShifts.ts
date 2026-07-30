import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import type { Shift } from '@cosp/portal-types';
import { getPortalFirebase } from '../lib/portal';
import { sortShiftsByStart } from '../lib/shifts';

export function useEmployeeShifts(empDocId: string | null) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!empDocId) {
      setShifts([]);
      setLoading(false);
      return;
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);

    const { db } = getPortalFirebase();
    const q = query(
      collection(db, 'turnos'),
      where('employeeId', '==', empDocId),
      where('startTime', '>=', Timestamp.fromDate(start)),
      where('startTime', '<=', Timestamp.fromDate(end)),
    );

    setLoading(true);
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
        setShifts(sortShiftsByStart(list));
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Error cargando turnos');
        setLoading(false);
      },
    );

    return unsub;
  }, [empDocId]);

  return { shifts, loading, error };
}
