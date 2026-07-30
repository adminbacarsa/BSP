import { useEffect, useState } from 'react';
import type { ObjectiveLocation } from '@cosp/portal-types';
import { loadObjectivesMap } from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';

export function useObjectivesMap() {
  const [objectivesMap, setObjectivesMap] = useState<Record<string, ObjectiveLocation>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { db } = getPortalFirebase();
        const map = await loadObjectivesMap(db);
        if (!cancelled) setObjectivesMap(map);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { objectivesMap, loading };
}
