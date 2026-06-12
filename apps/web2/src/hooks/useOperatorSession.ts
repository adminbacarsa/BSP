import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export interface OperatorSession {
  id: string;
  operatorId: string;
  operatorName: string;
  startTime: Date;
  endTime: Date | null;
  expiresAt: Date | null;
  status: 'ACTIVO' | 'CERRADO';
  empresaId: string;
  accionesCount: number;
}

export const useOperatorSession = () => {
  const { user } = useAuth();
  const { empresaId } = useEmpresa();
  const [activeSessions, setActiveSessions] = useState<OperatorSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaId) { setLoading(false); return; }
    const q = query(
      collection(db, 'sesiones_operador'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'ACTIVO'),
    );
    const unsub = onSnapshot(
      q,
      snap => {
        const now = new Date();
        const sessions = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            operatorId: data.operatorId,
            operatorName: data.operatorName,
            startTime: data.startTime?.toDate() || new Date(),
            endTime: data.endTime?.toDate() || null,
            expiresAt: data.expiresAt?.toDate?.() || null,
            status: data.status,
            empresaId: data.empresaId,
            accionesCount: data.accionesCount || 0,
          } as OperatorSession;
        })
        // Filtrar sesiones expiradas (si no tienen expiresAt, son sesiones legacy → se mantienen)
        .filter(s => !s.expiresAt || s.expiresAt > now)
        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
        setActiveSessions(sessions);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [empresaId]);

  const mySessions = useMemo(
    () => activeSessions.filter(s => s.operatorId === user?.uid),
    [activeSessions, user?.uid],
  );

  const mySession = mySessions[0] ?? null;

  const otherSessions = useMemo(
    () => activeSessions.filter(s => s.operatorId !== user?.uid),
    [activeSessions, user?.uid],
  );

  const startSession = useCallback(async () => {
    if (!user || !empresaId) return;
    const existing = await getDocs(query(
      collection(db, 'sesiones_operador'),
      where('empresaId', '==', empresaId),
      where('operatorId', '==', user.uid),
      where('status', '==', 'ACTIVO'),
    ));
    if (!existing.empty) return;
    await addDoc(collection(db, 'sesiones_operador'), {
      operatorId: user.uid,
      operatorName: user.email?.split('@')[0] || 'Operador',
      empresaId,
      startTime: serverTimestamp(),
      endTime: null,
      expiresAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS), // expira en 24h
      status: 'ACTIVO',
      accionesCount: 0,
    });
  }, [user, empresaId]);

  const endSession = useCallback(async () => {
    if (!user || !empresaId) throw new Error('Sin sesión de usuario');
    const toClose = mySessions.length
      ? mySessions
      : (await getDocs(query(
          collection(db, 'sesiones_operador'),
          where('empresaId', '==', empresaId),
          where('operatorId', '==', user.uid),
          where('status', '==', 'ACTIVO'),
        ))).docs.map(d => ({ id: d.id }));

    if (!toClose.length) throw new Error('No hay guardia activa');

    await Promise.all(toClose.map(s =>
      updateDoc(doc(db, 'sesiones_operador', s.id), {
        endTime: serverTimestamp(),
        status: 'CERRADO',
      }),
    ));
  }, [user, empresaId, mySessions]);

  // Auto-renovar TTL cuando quedan menos de 6h para expirar
  useEffect(() => {
    if (!mySession?.expiresAt) return;
    const timeToExpiry = mySession.expiresAt.getTime() - Date.now();
    if (timeToExpiry > 6 * 3600000) return; // más de 6h → no renovar todavía
    updateDoc(doc(db, 'sesiones_operador', mySession.id), {
      expiresAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
    }).catch(e => console.warn('[renewSession]', e));
  }, [mySession?.id, mySession?.expiresAt]);

  const isAutoMode = !loading && !mySession;
  const isMySession = !!mySession;

  return {
    activeSession: mySession,
    mySession,
    activeSessions,
    otherSessions,
    loading,
    startSession,
    endSession,
    isAutoMode,
    isMySession,
  };
};
