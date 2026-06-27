import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { supervisionFieldService } from '@/services/supervisionFieldService';

export type SupervisorObjective = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
};

/**
 * Alcance del módulo Supervisión:
 * - SuperAdmin → siempre ve todos los objetivos de la empresa.
 * - Supervisor → solo objetivosAsignados en system_users.
 */
export function useSupervisorScope(
  userUid: string | undefined,
  empresaId: string | undefined,
  isSuperAdmin: boolean,
) {
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [allObjectives, setAllObjectives] = useState<SupervisorObjective[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userUid || isSuperAdmin) {
      setAssignedIds([]);
      return;
    }
    getDoc(doc(db, 'system_users', userUid)).then(snap => {
      if (snap.exists()) setAssignedIds(snap.data().objetivosAsignados || []);
      else setAssignedIds([]);
    }).catch(() => setAssignedIds([]));
  }, [userUid, isSuperAdmin]);

  useEffect(() => {
    if (!empresaId) {
      setAllObjectives([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    supervisionFieldService.loadObjectivesForEmpresa(empresaId)
      .then(setAllObjectives)
      .finally(() => setLoading(false));
  }, [empresaId]);

  const canViewAllObjectives = isSuperAdmin;

  const scopedObjectives = useMemo(() => {
    if (isSuperAdmin) return allObjectives;
    if (!assignedIds.length) return [];
    const set = new Set(assignedIds);
    return allObjectives.filter(o => set.has(o.id));
  }, [allObjectives, assignedIds, isSuperAdmin]);

  const objectiveIds = useMemo(
    () => scopedObjectives.map(o => o.id),
    [scopedObjectives],
  );

  return {
    assignedIds,
    allObjectives,
    scopedObjectives,
    objectiveIds,
    canViewAllObjectives,
    loading,
  };
}
