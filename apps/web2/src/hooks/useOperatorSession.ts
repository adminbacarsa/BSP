import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

export interface OperatorSession {
  id: string;
  operatorId: string;
  operatorName: string;
  startTime: Date;
  endTime: Date | null;
  status: 'ACTIVO' | 'CERRADO';
  empresaId: string;
  accionesCount: number;
}

export const useOperatorSession = () => {
  const { user } = useAuth();
  const { empresaId } = useEmpresa();
  const [activeSession, setActiveSession] = useState<OperatorSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaId) { setLoading(false); return; }
    const q = query(
      collection(db, 'sesiones_operador'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'ACTIVO'),
      limit(1)
    );
    const unsub = onSnapshot(q, snap => {
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data();
        setActiveSession({
          id: d.id,
          operatorId: data.operatorId,
          operatorName: data.operatorName,
          startTime: data.startTime?.toDate() || new Date(),
          endTime: data.endTime?.toDate() || null,
          status: data.status,
          empresaId: data.empresaId,
          accionesCount: data.accionesCount || 0,
        });
      } else {
        setActiveSession(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [empresaId]);

  const startSession = async () => {
    if (!user || !empresaId) return;
    await addDoc(collection(db, 'sesiones_operador'), {
      operatorId: user.uid,
      operatorName: user.email?.split('@')[0] || 'Operador',
      empresaId,
      startTime: serverTimestamp(),
      endTime: null,
      status: 'ACTIVO',
      accionesCount: 0,
    });
  };

  const endSession = async () => {
    if (!activeSession) return;
    await updateDoc(doc(db, 'sesiones_operador', activeSession.id), {
      endTime: serverTimestamp(),
      status: 'CERRADO',
    });
  };

  const isAutoMode = !loading && !activeSession;
  const isMySession = activeSession?.operatorId === user?.uid;

  return { activeSession, loading, startSession, endSession, isAutoMode, isMySession };
};
