import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  updateDoc,
  doc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, onSnapshotFresh, functions } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { pickCanonicalPilotSession, type OpsSessionRole } from '@/lib/operaciones/opsMode';
import { PILOT_HEARTBEAT_MS, isPilotInactive, pilotInactiveMinutes } from '@/lib/operaciones/pilotInactivity';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type SesionOperadorAction =
  | 'start'
  | 'end'
  | 'requestPilot'
  | 'cancelPilotRequest'
  | 'acceptPilot'
  | 'rejectPilot'
  | 'passToAuto'
  | 'heartbeat'
  | 'takeOverPilot';

/** User agent corto para la bitácora de toma de mando. */
export function describeDevice(): string {
  if (typeof navigator === 'undefined') return 'WEB';
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Web';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : 'Navegador';
  const movil = /Mobi|Android|iPhone/i.test(ua) ? ' celular' : '';
  return `${os} ${browser}${movil}`.trim();
}

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
  /** Último heartbeat o acción (piloto sin actividad >= 5 min = se puede tomar el mando). */
  lastActivityAt: Date | null;
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
    lastActivityAt: data.lastActivityAt?.toDate?.() || null,
  };
}

export const useOperatorSession = () => {
  const { user } = useAuth();
  const { empresaId } = useEmpresa();
  const [activeSessions, setActiveSessions] = useState<OperatorSession[]>([]);
  const [loading, setLoading] = useState(true);
  const reconcileBusy = useRef(false);

  const callSesionOperador = useCallback(
    async (action: SesionOperadorAction, extra?: Record<string, unknown>) => {
      if (!empresaId) throw new Error('Sin empresa');
      const fn = httpsCallable(functions, 'sesionOperador');
      const movil = typeof window !== 'undefined' && window.innerWidth < 768;
      await fn({ action, empresaId, writeOrigin: movil ? 'MOBILE' : 'WEB', ...(extra || {}) });
    },
    [empresaId],
  );

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
    await callSesionOperador('start');
  }, [user, empresaId, callSesionOperador]);

  const endSession = useCallback(async () => {
    if (!user || !empresaId) throw new Error('Sin sesión de usuario');
    await callSesionOperador('end');
  }, [user, empresaId, callSesionOperador]);

  const endRoomToAuto = useCallback(async () => {
    if (!empresaId) throw new Error('Sin empresa');
    await callSesionOperador('passToAuto');
  }, [empresaId, callSesionOperador]);

  const requestPilot = useCallback(async () => {
    if (!mySession || isPilot) return;
    await callSesionOperador('requestPilot');
  }, [mySession, isPilot, callSesionOperador]);

  const cancelPilotRequest = useCallback(async () => {
    if (!mySession) return;
    await callSesionOperador('cancelPilotRequest');
  }, [mySession, callSesionOperador]);

  const acceptPilotRequest = useCallback(async () => {
    if (!isPilot || !pendingPilotRequest || !mySession) return;
    await callSesionOperador('acceptPilot');
  }, [isPilot, pendingPilotRequest, mySession, callSesionOperador]);

  const rejectPilotRequest = useCallback(async () => {
    if (!isPilot || !pendingPilotRequest) return;
    await callSesionOperador('rejectPilot');
  }, [isPilot, pendingPilotRequest, callSesionOperador]);

  /** Piloto de otro operador sin heartbeat hace >= 5 min: el copiloto puede tomar el mando sin aceptación. */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const pilotInactive = !!pilotSession && !isPilot && isPilotInactive(pilotSession, nowTick);
  const pilotInactiveMin = pilotSession ? pilotInactiveMinutes(pilotSession, nowTick) : 0;

  /**
   * Toma de mando por piloto inactivo. Si no estoy en la sala, primero entro (copiloto).
   * El servidor valida la inactividad y deja la bitácora (quién, dispositivo, motivo).
   */
  const takeOverPilot = useCallback(async () => {
    if (!user || !empresaId) throw new Error('Sin sesión de usuario');
    if (!mySession) await callSesionOperador('start');
    await callSesionOperador('takeOverPilot', { deviceInfo: describeDevice() });
  }, [user, empresaId, mySession, callSesionOperador]);

  /**
   * Heartbeat cada minuto mientras estoy en la sala, también con la pestaña en segundo plano:
   * un piloto con el CC minimizado sigue presente; solo la PC sin luz/red deja de latir.
   */
  useEffect(() => {
    if (!mySession?.id) return;
    const beat = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      updateDoc(doc(db, 'sesiones_operador', mySession.id), { lastActivityAt: Timestamp.now() })
        .catch((e) => console.warn('[heartbeat]', e));
    };
    beat();
    const id = setInterval(beat, PILOT_HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mySession?.id]);

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
    takeOverPilot,
    pilotInactive,
    pilotInactiveMin,
    isAutoMode,
    isMySession,
  };
};
