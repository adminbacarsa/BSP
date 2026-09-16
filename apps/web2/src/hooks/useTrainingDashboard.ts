import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { TrainingSession } from '@/lib/training/trainingSession';

export function useTrainingDashboard() {
  const { empresaId, empresa } = useEmpresa();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!empresa?.isTrainingEmpresa || !empresaId) {
      setSessions([]);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'training_sessions'),
      where('empresaId', '==', empresaId),
    );
    const unsub = onSnapshot(
      q,
      snap => {
        setSessions(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<TrainingSession, 'id'>) })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [empresaId, empresa?.isTrainingEmpresa]);

  return { sessions, loading };
}
