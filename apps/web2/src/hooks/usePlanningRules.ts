import { useEffect, useState } from 'react';
import { doc } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import {
  DEFAULT_PLANNING_RULES,
  mergePlanningRulesFromFirestore,
  type PlanningRulesConfig,
} from '@/lib/planning/planning-rules.types';

export function usePlanningRules(empresaId: string | null | undefined) {
  const [rules, setRules] = useState<PlanningRulesConfig>(DEFAULT_PLANNING_RULES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaId) {
      setRules(DEFAULT_PLANNING_RULES);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ref = doc(db, 'planning_rules', empresaId);
    const unsub = onSnapshotFresh(
      ref,
      (snap) => {
        setRules(mergePlanningRulesFromFirestore(snap.exists() ? (snap.data() as Partial<PlanningRulesConfig>) : null));
        setLoading(false);
      },
      () => {
        setRules(DEFAULT_PLANNING_RULES);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [empresaId]);

  return { rules, loading };
}
