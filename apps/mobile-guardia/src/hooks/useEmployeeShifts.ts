import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  Timestamp,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Shift } from '@cosp/portal-types';
import {
  isShiftVisibleToEmployee,
  shiftPlanificacionLookupKey,
  toDate,
} from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';
import { sortShiftsByStart } from '../lib/shifts';

function monthRange(anchor: Date) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function monthStringBounds(anchor: Date) {
  const y = anchor.getFullYear();
  const m = String(anchor.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, anchor.getMonth() + 1, 0).getDate();
  return {
    from: `${y}-${m}-01T00:00:00`,
    to: `${y}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59.999`,
  };
}

function shiftInMonth(shift: Shift, anchor: Date): boolean {
  const d = toDate(shift.startTime);
  if (!d) return false;
  return d.getFullYear() === anchor.getFullYear() && d.getMonth() === anchor.getMonth();
}

function buildMonthQueryTimestamp(employeeKey: string, anchor: Date): Query {
  const { start, end } = monthRange(anchor);
  const { db } = getPortalFirebase();
  return query(
    collection(db, 'turnos'),
    where('employeeId', '==', employeeKey),
    where('startTime', '>=', Timestamp.fromDate(start)),
    where('startTime', '<=', Timestamp.fromDate(end)),
  );
}

function buildMonthQueryString(employeeKey: string, anchor: Date): Query {
  const { from, to } = monthStringBounds(anchor);
  const { db } = getPortalFirebase();
  return query(
    collection(db, 'turnos'),
    where('employeeId', '==', employeeKey),
    where('startTime', '>=', from),
    where('startTime', '<=', to),
  );
}

/** Independiente del tipo de startTime: trae todos los EV del legajo. */
function buildEvCodeQuery(employeeKey: string): Query {
  const { db } = getPortalFirebase();
  return query(
    collection(db, 'turnos'),
    where('employeeId', '==', employeeKey),
    where('code', '==', 'EV'),
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

function hasPublishedAt(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const v = data.publishedAt;
  return v != null && v !== '';
}

export function useEmployeeShifts(
  empDocId: string | null,
  authUid: string | null,
  monthAnchor: Date = new Date(),
) {
  const [rawShifts, setRawShifts] = useState<Shift[]>([]);
  const [publishedKeys, setPublishedKeys] = useState<Set<string> | null>(null);
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
      setRawShifts([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    type Bucket = { ts: Shift[]; str: Shift[]; ev: Shift[] };
    const buckets: Record<string, Bucket> = {};
    let errorMessage: string | null = null;
    const anchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);

    const publish = () => {
      const lists = employeeKeys.map((k) => {
        const b = buckets[k] ?? { ts: [], str: [], ev: [] };
        const evInMonth = b.ev.filter((s) => shiftInMonth(s, anchor));
        return mergeShiftLists([b.ts, b.str, evInMonth]);
      });
      setRawShifts(mergeShiftLists(lists));
      setError(errorMessage);
      setLoading(false);
    };

    const unsubs: Unsubscribe[] = [];

    for (const key of employeeKeys) {
      buckets[key] = { ts: [], str: [], ev: [] };

      unsubs.push(
        onSnapshot(
          buildMonthQueryTimestamp(key, anchor),
          (snap) => {
            buckets[key].ts = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
            publish();
          },
          (err) => {
            if (!errorMessage) errorMessage = err.message || 'Error cargando turnos';
            buckets[key].ts = [];
            publish();
          },
        ),
      );

      unsubs.push(
        onSnapshot(
          buildMonthQueryString(key, anchor),
          (snap) => {
            buckets[key].str = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
            publish();
          },
          (err) => {
            if (!errorMessage) errorMessage = err.message || 'Error cargando turnos';
            buckets[key].str = [];
            publish();
          },
        ),
      );

      unsubs.push(
        onSnapshot(
          buildEvCodeQuery(key),
          (snap) => {
            buckets[key].ev = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
            publish();
          },
          (err) => {
            if (!errorMessage) errorMessage = err.message || 'Error cargando turnos EV';
            buckets[key].ev = [];
            publish();
          },
        ),
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [employeeKeys.join('|'), monthKey]);

  // Solo mostrar planificación si hay publishedAt en planificacion_estados.
  useEffect(() => {
    const { db } = getPortalFirebase();
    const targets = new Map<
      string,
      { objectiveId: string; year: number; month: number; empresaId: string }
    >();

    for (const s of rawShifts) {
      if ((s as { draft?: boolean }).draft === true) continue;
      const key = shiftPlanificacionLookupKey(s as never);
      if (!key || targets.has(key)) continue;
      const start = toDate(s.startTime);
      const objectiveId = String(s.objectiveId || '').trim();
      if (!start || !objectiveId) continue;
      targets.set(key, {
        objectiveId,
        year: start.getFullYear(),
        month: start.getMonth() + 1,
        empresaId: String((s as { empresaId?: string }).empresaId || '').trim(),
      });
    }

    if (targets.size === 0) {
      setPublishedKeys(new Set());
      return;
    }

    setPublishedKeys(null);
    const published = new Set<string>();
    const docPublished = new Map<string, boolean>();
    const realUnsubs: Unsubscribe[] = [];

    const bump = () => setPublishedKeys(new Set(published));

    for (const [lookupKey, t] of targets) {
      const docIds = [
        t.empresaId ? `${t.empresaId}_${t.objectiveId}_${t.year}_${t.month}` : null,
        `${t.objectiveId}_${t.year}_${t.month}`,
      ].filter((id, i, arr): id is string => !!id && arr.indexOf(id) === i);

      const recompute = () => {
        const ok = docIds.some((id) => docPublished.get(id) === true);
        if (ok) published.add(lookupKey);
        else published.delete(lookupKey);
        bump();
      };

      for (const docId of docIds) {
        realUnsubs.push(
          onSnapshot(
            doc(db, 'planificacion_estados', docId),
            (snap) => {
              docPublished.set(
                docId,
                snap.exists() && hasPublishedAt(snap.data() as Record<string, unknown>),
              );
              recompute();
            },
            () => {
              docPublished.set(docId, false);
              recompute();
            },
          ),
        );
      }
    }

    return () => {
      realUnsubs.forEach((u) => u());
    };
  }, [rawShifts]);

  const shifts = useMemo(
    () =>
      sortShiftsByStart(
        rawShifts.filter((s) => isShiftVisibleToEmployee(s as never, publishedKeys)),
      ),
    [rawShifts, publishedKeys],
  );

  return {
    shifts,
    loading: loading || (rawShifts.length > 0 && publishedKeys == null),
    error,
    hasEmployeeKey: employeeKeys.length > 0,
  };
}
