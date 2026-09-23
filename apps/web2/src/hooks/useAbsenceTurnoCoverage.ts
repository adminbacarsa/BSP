import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Absence } from '@/services/absenceService';
import { alignAbsencesWithShiftMap } from '@/lib/rrhh/absenceCoverageAlign';

const CHUNK = 24;

async function fetchShiftsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const snaps = await Promise.all(slice.map((id) => getDoc(doc(db, 'turnos', id))));
    snaps.forEach((snap, idx) => {
      if (!snap.exists()) return;
      map.set(slice[idx], { id: snap.id, ...snap.data() } as Record<string, unknown>);
    });
  }
  return map;
}

/**
 * Enriquece ausencias con cobertura derivada del turno titular (shiftId).
 */
export function useAbsenceTurnoCoverage(absences: Absence[]) {
  const [shiftById, setShiftById] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [loading, setLoading] = useState(false);

  const shiftIdsKey = useMemo(() => {
    const set = new Set<string>();
    for (const a of absences) {
      const sid = String((a as Absence & { shiftId?: string }).shiftId || '').trim();
      if (sid) set.add(sid);
    }
    return [...set].sort().join('|');
  }, [absences]);

  useEffect(() => {
    const ids = shiftIdsKey ? shiftIdsKey.split('|').filter(Boolean) : [];
    if (!ids.length) {
      setShiftById(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchShiftsByIds(ids)
      .then((map) => {
        if (!cancelled) setShiftById(map);
      })
      .catch((e) => {
        console.error('useAbsenceTurnoCoverage:', e);
        if (!cancelled) setShiftById(new Map());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shiftIdsKey]);

  const alignedAbsences = useMemo(
    () => alignAbsencesWithShiftMap(absences, shiftById),
    [absences, shiftById],
  );

  return { alignedAbsences, loadingShifts: loading };
}
