import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import {
  TrainingSession,
  loadOrCreateSession,
  sessionDocId,
} from '@/lib/training/trainingSession';

interface UseTrainingSessionResult {
  session: TrainingSession | null;
  loading: boolean;
}

export function useTrainingSession(): UseTrainingSessionResult {
  const { user, rolePermissions, userRole } = useAuth();
  const { empresa } = useEmpresa();
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loading, setLoading] = useState(false);
  const creatingRef = useRef(false);

  const isTraining = !!empresa?.isTrainingEmpresa;
  const empresaId  = empresa?.id ?? '';
  const userId     = user?.uid ?? '';

  // Suscripción en tiempo real al documento de sesión
  useEffect(() => {
    if (!isTraining || !userId || !empresaId) {
      setSession(null);
      return;
    }

    const docId = sessionDocId(empresaId, userId);
    const ref = doc(db, 'training_sessions', docId);

    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        setSession({ id: docId, ...(snap.data() as Omit<TrainingSession, 'id'>) });
        setLoading(false);
      } else if (!creatingRef.current) {
        // Sesión no existe aún — crear
        creatingRef.current = true;
        setLoading(true);
        loadOrCreateSession({
          userId,
          userEmail: user?.email ?? '',
          empresaId,
          roleId: userRole ?? '',
          rolePermissions: rolePermissions ?? {},
        })
          .then(s => setSession(s))
          .catch(err => console.warn('[training] no se pudo crear sesión:', err))
          .finally(() => {
            creatingRef.current = false;
            setLoading(false);
          });
      }
    });

    return () => unsub();
  }, [isTraining, userId, empresaId, user?.email, userRole, rolePermissions]);

  return { session, loading };
}
