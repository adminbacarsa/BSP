import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { pickCanonicalPilotSession, type OpsSessionRole } from '@/lib/operaciones/opsMode';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type PilotRequestStatus = 'NONE' | 'PENDING' | 'REJECTED';

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
  role: OpsSessionRole;
  pilotRequestStatus: PilotRequestStatus;
  pilotRequestedAt: Date | null;
}

function mapSession(id: string, data: Record<string, any>): OperatorSession {
  const roleRaw = String(data.role || '').toUpperCase();
  const role: OpsSessionRole = roleRaw === 'COPILOTO' ? 'COPILOTO' : 'PILOTO';
  const req = String(data.pilotRequestStatus || 'NONE').toUpperCase();
  const pilotRequestStatus: PilotRequestStatus =
    req === 'PENDING' ? 'PENDING' : req === 'REJECTED' ? 'REJECTED' : 'NONE';
  return {
    id,
    operatorId: data.operatorId,
    operatorName: data.operatorName,
    startTime: data.startTime?.toDate?.() || new Date(),
    endTime: data.endTime?.toDate?.() || null,
    expiresAt: data.expiresAt?.toDate?.() || null,
    status: data.status,
    empresaId: data.empresaId,
    accionesCount: data.accionesCount || 0,
    role,
    pilotRequestStatus,
    pilotRequestedAt: data.pilotRequestedAt?.toDate?.() || null,
  };
}

export const useOperatorSession = () => {
  const { user } = useAuth();
  const { empresaId } = useEmpresa();
  const [activeSessions, setActiveSessions] = useState<OperatorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const reconcileBusy = useRef(false);

  useEffect(() => {
    if (!empresaId) {
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, 'sesiones_operador'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'ACTIVO'),
    );
    const unsub = onSnapshotFresh(
      q,
      (snap) => {
        const now = new Date();
        const sessions = snap.docs
          .map((d) => mapSession(d.id, d.data()))
          .filter((s) => !s.expiresAt || s.expiresAt > now)
          .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        setActiveSessions(sessions);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [empresaId]);

  /** Un solo piloto canónico = sesión más antigua. */
  useEffect(() => {
    if (!empresaId || loading || !activeSessions.length) return;
    if (reconcileBusy.current) return;
    const canonical = pickCanonicalPilotSession(activeSessions);
    if (!canonical) return;
    const fixes = activeSessions.filter((s) => {
      const want: OpsSessionRole = s.id === canonical.id ? 'PILOTO' : 'COPILOTO';
      return s.role !== want;
    });
    if (!fixes.length) return;
    reconcileBusy.current = true;
    const batch = writeBatch(db);
    for (const s of fixes) {
      const want: OpsSessionRole = s.id === canonical.id ? 'PILOTO' : 'COPILOTO';
      batch.update(doc(db, 'sesiones_operador', s.id), { role: want });
    }
    batch
      .commit()
      .catch((e) => console.warn('[opsSala reconcile]', e))
      .finally(() => {
        reconcileBusy.current = false;
      });
  }, [empresaId, loading, activeSessions]);

  const mySessions = useMemo(
    () => activeSessions.filter((s) => s.operatorId === user?.uid),
    [activeSessions, user?.uid],
  );

  const mySession = mySessions[0] ?? null;

  const otherSessions = useMemo(
    () => activeSessions.filter((s) => s.operatorId !== user?.uid),
    [activeSessions, user?.uid],
  );

  const pilotSession = useMemo(
    () => activeSessions.find((s) => s.role === 'PILOTO') || pickCanonicalPilotSession(activeSessions),
    [activeSessions],
  );

  const copilotoSessions = useMemo(
    () => activeSessions.filter((s) => s.id !== pilotSession?.id),
    [activeSessions, pilotSession?.id],
  );

  const pendingPilotRequest = useMemo(
    () => activeSessions.find((s) => s.pilotRequestStatus === 'PENDING' && s.role === 'COPILOTO') || null,
    [activeSessions],
  );

  const hasRoomManual = activeSessions.length > 0;
  const isPilot = !!mySession && pilotSession?.operatorId === user?.uid;
  const isCopiloto = !!mySession && !isPilot;
  const inRoom = !!mySession;

  const startSession = useCallback(async () => {
    if (!user || !empresaId) return;
    const existing = await getDocs(
      query(
        collection(db, 'sesiones_operador'),
        where('empresaId', '==', empresaId),
        where('operatorId', '==', user.uid),
        where('status', '==', 'ACTIVO'),
      ),
    );
    if (!existing.empty) return;

    const roomSnap = await getDocs(
      query(
        collection(db, 'sesiones_operador'),
        where('empresaId', '==', empresaId),
        where('status', '==', 'ACTIVO'),
      ),
    );
    const roomBusy = roomSnap.docs.some((d) => {
      const exp = d.data().expiresAt?.toDate?.();
      return !exp || exp > new Date();
    });
    const role: OpsSessionRole = roomBusy ? 'COPILOTO' : 'PILOTO';

    await addDoc(collection(db, 'sesiones_operador'), {
      operatorId: user.uid,
      operatorName: user.email?.split('@')[0] || 'Operador',
      empresaId,
      startTime: serverTimestamp(),
      endTime: null,
      expiresAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
      status: 'ACTIVO',
      accionesCount: 0,
      role,
      pilotRequestStatus: 'NONE',
      pilotRequestedAt: null,
    });
  }, [user, empresaId]);

  const closeSessionsByIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const batch = writeBatch(db);
    for (const id of ids) {
      batch.update(doc(db, 'sesiones_operador', id), {
        endTime: serverTimestamp(),
        status: 'CERRADO',
        pilotRequestStatus: 'NONE',
        pilotRequestedAt: null,
      });
    }
    await batch.commit();
  }, []);

  /** Sale solo yo (copiloto o piloto que deja la sala sin forzar Auto si quedan otros — reconcile asigna piloto). */
  const endSession = useCallback(async () => {
    if (!user || !empresaId) throw new Error('Sin sesión de usuario');
    const toClose = mySessions.length
      ? mySessions
      : (
          await getDocs(
            query(
              collection(db, 'sesiones_operador'),
              where('empresaId', '==', empresaId),
              where('operatorId', '==', user.uid),
              where('status', '==', 'ACTIVO'),
            ),
          )
        ).docs.map((d) => ({ id: d.id }));

    if (!toClose.length) throw new Error('No hay guardia activa');
    await closeSessionsByIds(toClose.map((s) => s.id));
  }, [user, empresaId, mySessions, closeSessionsByIds]);

  /** Piloto (o SA): cierra TODA la sala → empresa en Auto. */
  const endRoomToAuto = useCallback(async () => {
    if (!empresaId) throw new Error('Sin empresa');
    const ids = activeSessions.map((s) => s.id);
    if (!ids.length) {
      const snap = await getDocs(
        query(
          collection(db, 'sesiones_operador'),
          where('empresaId', '==', empresaId),
          where('status', '==', 'ACTIVO'),
        ),
      );
      await closeSessionsByIds(snap.docs.map((d) => d.id));
      return;
    }
    await closeSessionsByIds(ids);
  }, [empresaId, activeSessions, closeSessionsByIds]);

  const requestPilot = useCallback(async () => {
    if (!mySession || isPilot) return;
    await updateDoc(doc(db, 'sesiones_operador', mySession.id), {
      pilotRequestStatus: 'PENDING',
      pilotRequestedAt: serverTimestamp(),
    });
  }, [mySession, isPilot]);

  const cancelPilotRequest = useCallback(async () => {
    if (!mySession) return;
    await updateDoc(doc(db, 'sesiones_operador', mySession.id), {
      pilotRequestStatus: 'NONE',
      pilotRequestedAt: null,
    });
  }, [mySession]);

  const acceptPilotRequest = useCallback(async () => {
    if (!isPilot || !pendingPilotRequest || !mySession) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'sesiones_operador', pendingPilotRequest.id), {
      role: 'PILOTO',
      pilotRequestStatus: 'NONE',
      pilotRequestedAt: null,
      startTime: Timestamp.fromMillis(
        Math.min(mySession.startTime.getTime() - 1000, Date.now() - 1000),
      ),
    });
    batch.update(doc(db, 'sesiones_operador', mySession.id), {
      role: 'COPILOTO',
      pilotRequestStatus: 'NONE',
    });
    await batch.commit();
  }, [isPilot, pendingPilotRequest, mySession]);

  const rejectPilotRequest = useCallback(async () => {
    if (!isPilot || !pendingPilotRequest) return;
    await updateDoc(doc(db, 'sesiones_operador', pendingPilotRequest.id), {
      pilotRequestStatus: 'REJECTED',
      pilotRequestedAt: null,
    });
  }, [isPilot, pendingPilotRequest]);

  useEffect(() => {
    if (!mySession?.expiresAt) return;
    const timeToExpiry = mySession.expiresAt.getTime() - Date.now();
    if (timeToExpiry > 6 * 3600000) return;
    updateDoc(doc(db, 'sesiones_operador', mySession.id), {
      expiresAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
    }).catch((e) => console.warn('[renewSession]', e));
  }, [mySession?.id, mySession?.expiresAt]);

  /** @deprecated usar !hasRoomManual — Auto es de sala, no “yo sin sesión”. */
  const isAutoMode = !loading && !hasRoomManual;
  const isMySession = !!mySession;

  return {
    activeSession: mySession,
    mySession,
    activeSessions,
    otherSessions,
    pilotSession,
    copilotoSessions,
    pendingPilotRequest,
    hasRoomManual,
    isPilot,
    isCopiloto,
    inRoom,
    loading,
    startSession,
    endSession,
    endRoomToAuto,
    requestPilot,
    cancelPilotRequest,
    acceptPilotRequest,
    rejectPilotRequest,
    isAutoMode,
    isMySession,
  };
};
