import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  Timestamp,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { useSupervisionTablero } from '@/hooks/useSupervisionTablero';
import {
  auditLogTimestampMs,
  buildAuditLogsRecentQuery,
} from '@/lib/multiempresa';
import {
  resolveOpsMode,
  pickCanonicalPilotSession,
  type OpsMode,
  type OpsSessionRole,
} from '@/lib/operaciones/opsMode';
import { dayBoundsAr, todayStrAr } from '@/lib/supervision/supervisionUtils';
import type { ObjectiveLiveSummary } from '@/hooks/useSupervisionTablero';

export type CcSessionRow = {
  id: string;
  operatorId: string;
  operatorName: string;
  role: OpsSessionRole;
  status: 'ACTIVO' | 'CERRADO';
  startTime: Date;
  endTime: Date | null;
};

export type CcInformeRow = {
  id: string;
  operatorId: string;
  operatorName: string;
  guardiaStart: Date;
  guardiaEnd: Date;
  resumen: Record<string, number>;
  observaciones?: string;
  totalEventos?: number;
  novedadesPendientes?: number;
};

export type CcAuditSummary = {
  total: number;
  coberturas: number;
  ingresos: number;
  ausencias: number;
  guardiaEvents: number;
};

function mapSession(id: string, data: Record<string, unknown>): CcSessionRow {
  const roleRaw = String(data.role || '').toUpperCase();
  const role: OpsSessionRole = roleRaw === 'COPILOTO' ? 'COPILOTO' : 'PILOTO';
  const st = String(data.status || 'ACTIVO').toUpperCase();
  return {
    id,
    operatorId: String(data.operatorId || ''),
    operatorName: String(data.operatorName || 'Operador'),
    role,
    status: st === 'CERRADO' ? 'CERRADO' : 'ACTIVO',
    startTime: (data.startTime as { toDate?: () => Date })?.toDate?.() || new Date(),
    endTime: (data.endTime as { toDate?: () => Date })?.toDate?.() || null,
  };
}

function sessionOverlapsDay(s: CcSessionRow, ymd: string): boolean {
  const { start, end } = dayBoundsAr(ymd);
  const sStart = s.startTime.getTime();
  const sEnd = s.endTime?.getTime() ?? Date.now();
  return sStart <= end.getTime() && sEnd >= start.getTime();
}

export function useSupervisionCcBoard(
  dateYmd: string,
  objectiveIds: string[],
  canViewAllObjectives: boolean,
) {
  const { empresaId, empresa } = useEmpresa();
  const isToday = dateYmd === todayStrAr();
  const tablero = useSupervisionTablero(objectiveIds, canViewAllObjectives);

  const [activeSessions, setActiveSessions] = useState<CcSessionRow[]>([]);
  const [daySessions, setDaySessions] = useState<CcSessionRow[]>([]);
  const [informes, setInformes] = useState<CcInformeRow[]>([]);
  const [auditSummary, setAuditSummary] = useState<CcAuditSummary | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  useEffect(() => {
    if (!empresaId) return;
    const q = query(
      collection(db, 'sesiones_operador'),
      where('empresaId', '==', empresaId),
      where('status', '==', 'ACTIVO'),
    );
    const unsub = onSnapshotFresh(q, (snap) => {
      const rows = snap.docs.map((d) => mapSession(d.id, d.data() as Record<string, unknown>));
      setActiveSessions(rows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()));
    });
    return () => unsub();
  }, [empresaId]);

  const loadDayData = useCallback(async () => {
    if (!empresaId) return;
    setLoadingDay(true);
    try {
      const { start, end } = dayBoundsAr(dateYmd);
      const lookback = new Date(start);
      lookback.setDate(lookback.getDate() - 2);

      const sessSnap = await getDocs(
        query(
          collection(db, 'sesiones_operador'),
          where('empresaId', '==', empresaId),
          where('startTime', '>=', Timestamp.fromDate(lookback)),
        ),
      );
      const sessions = sessSnap.docs
        .map((d) => mapSession(d.id, d.data() as Record<string, unknown>))
        .filter((s) => sessionOverlapsDay(s, dateYmd))
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      setDaySessions(sessions);

      const infSnap = await getDocs(
        query(collection(db, 'informes_guardia'), where('empresaId', '==', empresaId)),
      );
      const informesRows: CcInformeRow[] = [];
      infSnap.docs.forEach((d) => {
        const data = d.data();
        const gs = (data.guardiaStart as { toDate?: () => Date })?.toDate?.();
        const ge = (data.guardiaEnd as { toDate?: () => Date })?.toDate?.();
        if (!gs) return;
        if (gs.getTime() < start.getTime() || gs.getTime() > end.getTime()) return;
        informesRows.push({
          id: d.id,
          operatorId: String(data.operatorId || ''),
          operatorName: String(data.operatorName || 'Operador'),
          guardiaStart: gs,
          guardiaEnd: ge || gs,
          resumen: (data.resumen as Record<string, number>) || {},
          observaciones: data.observaciones ? String(data.observaciones) : undefined,
          totalEventos: typeof data.totalEventos === 'number' ? data.totalEventos : undefined,
          novedadesPendientes:
            typeof data.novedadesPendientes === 'number' ? data.novedadesPendientes : undefined,
        });
      });
      informesRows.sort((a, b) => a.guardiaStart.getTime() - b.guardiaStart.getTime());
      setInformes(informesRows);

      const scopeEmpresa = true;
      const auditQ = buildAuditLogsRecentQuery(empresaId, scopeEmpresa, {
        since: start,
        limit: 400,
      });
      const auditSnap = await getDocs(auditQ);
      const endMs = end.getTime();
      let total = 0;
      let coberturas = 0;
      let ingresos = 0;
      let ausencias = 0;
      let guardiaEvents = 0;
      auditSnap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const ms = auditLogTimestampMs(data);
        if (ms > endMs) return;
        if (data.module !== 'OPERACIONES' && data.module !== 'OPERACIONES_CC') return;
        total += 1;
        const a = String(data.action || '').toUpperCase();
        if (['COVERAGE', 'COBERTURA_RELEVO'].some((x) => a.includes(x))) coberturas += 1;
        if (['CHECKIN', 'CHECK_IN', 'HANDOVER', 'PRESENTE'].includes(a)) ingresos += 1;
        if (['MARK_ABSENT', 'AUSENTE', 'ATTENDANCE'].includes(a)) ausencias += 1;
        if (a.includes('GUARDIA') || a.includes('SESION')) guardiaEvents += 1;
      });
      setAuditSummary({ total, coberturas, ingresos, ausencias, guardiaEvents });
    } catch (e) {
      console.warn('[useSupervisionCcBoard]', e);
      setDaySessions([]);
      setInformes([]);
      setAuditSummary(null);
    } finally {
      setLoadingDay(false);
    }
  }, [empresaId, dateYmd]);

  useEffect(() => {
    loadDayData();
  }, [loadDayData]);

  const modoDemo = empresa?.modoDemoEnabled === true;
  const hasRoomManual = isToday ? activeSessions.length > 0 : daySessions.some((s) => s.status === 'ACTIVO');
  const opsMode: OpsMode = isToday
    ? resolveOpsMode({ modoDemoEnabled: modoDemo, hasRoomManual, sessionLoading: false })
    : modoDemo
      ? 'DEMO'
      : daySessions.length > 0
        ? 'MANUAL'
        : 'AUTO';

  const livePilot = useMemo(() => {
    if (!isToday || !activeSessions.length) return null;
    return pickCanonicalPilotSession(activeSessions) || activeSessions.find((s) => s.role === 'PILOTO') || null;
  }, [isToday, activeSessions]);

  const liveSupport = useMemo(() => {
    if (!isToday || !livePilot) return [];
    return activeSessions.filter((s) => s.id !== livePilot.id);
  }, [isToday, activeSessions, livePilot]);

  const mandosDelDia = useMemo(() => {
    return daySessions.filter((s) => s.role === 'PILOTO');
  }, [daySessions]);

  const objectiveSummaries: ObjectiveLiveSummary[] = isToday ? tablero.objectiveSummaries : [];
  const totals = isToday ? tablero.totals : null;
  const isLiveReady = isToday ? tablero.isReady && tablero.isStable : true;

  return {
    dateYmd,
    isToday,
    opsMode,
    modoDemo,
    activeSessions: isToday ? activeSessions : [],
    daySessions,
    mandosDelDia,
    livePilot,
    liveSupport,
    informes,
    auditSummary,
    loadingDay,
    reloadDay: loadDayData,
    objectiveSummaries,
    totals,
    isLiveReady,
    empresaName: empresa?.name || empresaId || '',
  };
}
