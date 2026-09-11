/**
 * CoverageSessionManager
 * Gestor de sesiones de cobertura con múltiples ausencias simultáneas.
 * Renderiza:
 *   - Barra de tabs persistente al fondo del mapa (una por ausencia activa)
 *   - Panel expandido para la sesión seleccionada (no modal bloqueante)
 * Cada sesión tiene su propio countdown corriendo independientemente.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  X, ChevronRight, Phone, SkipForward, CheckCircle,
  AlertTriangle, Users, Clock, Minimize2,
} from 'lucide-react';
import {
  collection, doc, addDoc, writeBatch, serverTimestamp, Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { toast } from 'sonner';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type StepKey = 'SIN_TURNO' | 'RET_PASIVO' | 'ESC' | 'RETENCION' | 'FT';

export interface PendingSlot { notifId: string; empId: string; sec: number; }

export type SessionStatus = 'SELECTING' | 'PENDING' | 'PENDING_DUAL' | 'CONFIRMED' | 'FAILED';

export interface CoverageSession {
  id: string;
  absentShift: any;
  empresaId: string;
  status: SessionStatus;
  currentStep: number;
  pending: PendingSlot | null;
  pendingExt: PendingSlot | null;
  pendingAdv: PendingSlot | null;
  confirmedExt: string | null;
  confirmedAdv: string | null;
  awaitingPhone: boolean;
  selectedExtId: string | null;
  selectedAdvId: string | null;
  minimized: boolean;
}

export type SessionAction =
  | { type: 'SET_STATUS'; status: SessionStatus }
  | { type: 'SET_STEP'; step: number }
  | { type: 'SET_PENDING'; pending: PendingSlot | null }
  | { type: 'SET_PENDING_EXT'; slot: PendingSlot | null }
  | { type: 'SET_PENDING_ADV'; slot: PendingSlot | null }
  | { type: 'SET_CONFIRMED_EXT'; empId: string | null }
  | { type: 'SET_CONFIRMED_ADV'; empId: string | null }
  | { type: 'SET_AWAITING_PHONE'; v: boolean }
  | { type: 'SELECT_EXT'; id: string | null }
  | { type: 'SELECT_ADV'; id: string | null }
  | { type: 'TICK_PENDING' }
  | { type: 'TICK_DUAL' }
  | { type: 'TOGGLE_MINIMIZED' }
  | { type: 'PATCH'; patch: Partial<CoverageSession> };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STEPS: { key: StepKey; label: string; icon: string; mandatory: boolean; timeoutSec: number; isDual?: boolean }[] = [
  { key: 'SIN_TURNO',  label: 'Sin turno',        icon: '1', mandatory: true,  timeoutSec: 60  },
  { key: 'RET_PASIVO', label: 'Ret. Pasiva',       icon: '2', mandatory: true,  timeoutSec: 180 },
  { key: 'ESC',        label: 'ESC / REF',         icon: '3', mandatory: true,  timeoutSec: 60  },
  { key: 'RETENCION',  label: 'Ext. 12h',          icon: '4', mandatory: false, timeoutSec: 60, isDual: true },
  { key: 'FT',         label: 'Franco Trabajado',  icon: '5', mandatory: false, timeoutSec: 180 },
];

const fmtCd = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
const toDate = (d: any): Date => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const fmtTime = (d: any) => { try { return toDate(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch { return '--:--'; } };
const isSameDay = (d1: any, d2: any) => toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA');
const simPhone = (id: string) => { const n = parseInt(id.replace(/\D/g, '')) || 1; return `+54 9 351 ${String(n * 1317 % 10000).padStart(4, '0')}-${String(n * 7531 % 10000).padStart(4, '0')}`; };
const initials = (name: string) => (name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

export function createSession(absentShift: any, empresaId: string): CoverageSession {
  return {
    id: `cov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    absentShift,
    empresaId,
    status: 'SELECTING',
    currentStep: 0,
    pending: null,
    pendingExt: null,
    pendingAdv: null,
    confirmedExt: null,
    confirmedAdv: null,
    awaitingPhone: false,
    selectedExtId: null,
    selectedAdvId: null,
    minimized: false,
  };
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  sessions: CoverageSession[];
  activeId: string | null;
  logic: any;  // { processedData, employees }
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onUpdate: (id: string, fn: (s: CoverageSession) => CoverageSession) => void;
}

export function CoverageSessionManager({ sessions, activeId, logic, onActivate, onClose, onUpdate }: Props) {
  // Timers: un interval por sesión en PENDING/PENDING_DUAL
  const timerRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const unsubRefs = useRef<Record<string, () => void>>({});

  const upd = useCallback((id: string, patch: Partial<CoverageSession>) => {
    onUpdate(id, s => ({ ...s, ...patch }));
  }, [onUpdate]);

  // Gestión de timers por sesión
  useEffect(() => {
    sessions.forEach(s => {
      const hasTimer = !!timerRefs.current[s.id];
      if ((s.status === 'PENDING' || s.status === 'PENDING_DUAL') && !hasTimer) {
        timerRefs.current[s.id] = setInterval(() => {
          onUpdate(s.id, sess => {
            if (sess.status === 'PENDING' && sess.pending) {
              const next = sess.pending.sec - 1;
              if (next <= 0) return { ...sess, pending: { ...sess.pending, sec: 0 }, awaitingPhone: true };
              return { ...sess, pending: { ...sess.pending, sec: next } };
            }
            if (sess.status === 'PENDING_DUAL') {
              const newExt = sess.pendingExt && sess.pendingExt.sec > 0 ? { ...sess.pendingExt, sec: sess.pendingExt.sec - 1 } : sess.pendingExt;
              const newAdv = sess.pendingAdv && sess.pendingAdv.sec > 0 ? { ...sess.pendingAdv, sec: sess.pendingAdv.sec - 1 } : sess.pendingAdv;
              return { ...sess, pendingExt: newExt, pendingAdv: newAdv };
            }
            return sess;
          });
        }, 1000);
      }
      if (s.status !== 'PENDING' && s.status !== 'PENDING_DUAL' && hasTimer) {
        clearInterval(timerRefs.current[s.id]);
        delete timerRefs.current[s.id];
      }
    });
    // Limpiar timers de sesiones cerradas
    Object.keys(timerRefs.current).forEach(id => {
      if (!sessions.find(s => s.id === id)) {
        clearInterval(timerRefs.current[id]);
        delete timerRefs.current[id];
      }
    });
  }, [sessions, onUpdate]);

  // Cleanup al desmontar
  useEffect(() => () => {
    Object.values(timerRefs.current).forEach(clearInterval);
    Object.values(unsubRefs.current).forEach(fn => fn());
  }, []);

  if (sessions.length === 0) return null;

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  return (
    <>
      {/* Panel expandido de la sesión activa */}
      {activeSession && !activeSession.minimized && (
        <CoveragePanel
          key={activeSession.id}
          session={activeSession}
          logic={logic}
          onUpd={(patch) => upd(activeSession.id, patch)}
          onClose={() => onClose(activeSession.id)}
          onMinimize={() => upd(activeSession.id, { minimized: true })}
          unsubRefs={unsubRefs.current}
        />
      )}

      {/* Tab bar persistente */}
      <div className="fixed bottom-0 left-0 right-0 z-[8900] flex items-end gap-1 px-3 pb-0 pointer-events-none">
        <div className="flex items-end gap-1 pointer-events-auto overflow-x-auto pb-0 max-w-full">
          {sessions.map(s => {
            const step = STEPS[s.currentStep];
            const isActive = s.id === activeId;
            const isPending = s.status === 'PENDING' || s.status === 'PENDING_DUAL';
            const isConfirmed = s.status === 'CONFIRMED';
            const isFailed = s.status === 'FAILED';
            const sec = s.status === 'PENDING' ? (s.pending?.sec ?? 0)
              : s.status === 'PENDING_DUAL' ? Math.min(s.pendingExt?.sec ?? 999, s.pendingAdv?.sec ?? 999)
              : 0;

            const tabColor = isConfirmed ? 'bg-emerald-600 border-emerald-700'
              : isFailed ? 'bg-slate-600 border-slate-700'
              : isPending ? 'bg-amber-500 border-amber-600'
              : isActive ? 'bg-rose-600 border-rose-700'
              : 'bg-slate-700 border-slate-600';

            return (
              <div
                key={s.id}
                onClick={() => { onActivate(s.id); upd(s.id, { minimized: false }); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl border border-b-0 cursor-pointer transition-all text-white text-xs font-bold shrink-0 ${tabColor} ${isActive && !s.minimized ? 'pb-3' : 'hover:pb-3'}`}
                style={{ minWidth: 0 }}
              >
                {/* Icono de estado */}
                <span className="text-[11px]">
                  {isConfirmed ? '✓' : isFailed ? '✗' : isPending ? (s.awaitingPhone ? '📞' : '⏳') : '●'}
                </span>
                {/* Nombre del ausente */}
                <span className="max-w-[100px] truncate">
                  {(s.absentShift.employeeName || 'Vacante').split(',')[0]}
                </span>
                {/* Countdown inline */}
                {isPending && sec < 999 && (
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${sec <= 10 ? 'bg-red-700' : 'bg-black/20'}`}>
                    {fmtCd(sec)}
                  </span>
                )}
                {/* Paso actual */}
                {!isConfirmed && !isFailed && (
                  <span className="text-[9px] opacity-70">P{s.currentStep + 1}</span>
                )}
                {/* Cerrar */}
                <button
                  onClick={e => { e.stopPropagation(); onClose(s.id); }}
                  className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Panel de sesión ──────────────────────────────────────────────────────────

interface PanelProps {
  session: CoverageSession;
  logic: any;
  onUpd: (patch: Partial<CoverageSession>) => void;
  onClose: () => void;
  onMinimize: () => void;
  unsubRefs: Record<string, () => void>;
}

function CoveragePanel({ session: s, logic, onUpd, onClose, onMinimize, unsubRefs }: PanelProps) {
  const [loading, setLoading] = React.useState<string | null>(null);
  const tid = s.empresaId;
  const absenceShift = s.absentShift;
  const step = STEPS[s.currentStep];
  const now = new Date();
  const absenceEnd = toDate(absenceShift.endDateObj);
  const hiStart = fmtTime(absenceShift.shiftDateObj);
  const hiEnd = fmtTime(absenceShift.endDateObj);

  // ── Candidatos ─────────────────────────────────────────────────────────────
  const busyIds = new Set<string>(
    (logic.processedData || [])
      .filter((sh: any) => isSameDay(sh.shiftDateObj, now) && !sh.isFranco && sh.code !== 'RET' && sh.code !== 'ESC' && sh.code !== 'REF')
      .map((sh: any) => sh.employeeId)
  );
  const byKey = (key: StepKey): any[] => {
    switch (key) {
      case 'SIN_TURNO':
        return (logic.employees || [])
          .filter((e: any) => !busyIds.has(e.id) && e.id !== absenceShift.employeeId)
          .map((e: any) => ({ ...e, fullName: e.firstName ? `${e.firstName} ${e.lastName || ''}`.trim() : e.name || e.fullName || '', phone: e.phone || e.celular || '' }));
      case 'RET_PASIVO':
        return (logic.processedData || []).filter((sh: any) => sh.code === 'RET' && !sh.isAbsent && sh.employeeId !== absenceShift.employeeId);
      case 'ESC':
        return (logic.processedData || []).filter((sh: any) => (sh.code === 'ESC' || sh.code === 'REF') && !sh.isAbsent && sh.employeeId !== absenceShift.employeeId);
      case 'RETENCION':
        return []; // dual — manejado por renderDual
      case 'FT':
        return (logic.processedData || [])
          .filter((sh: any) => sh.isFranco && isSameDay(sh.shiftDateObj, now) && !sh.isFrancoTrabajado)
          .map((sh: any) => { const emp = (logic.employees || []).find((e: any) => e.id === sh.employeeId); return { ...sh, fullName: sh.employeeName, phone: sh.phone || emp?.phone || emp?.celular || '' }; });
    }
  };

  const candidatesExt = (logic.processedData || []).filter((sh: any) =>
    sh.isPresent && !sh.isCompleted && sh.objectiveId === absenceShift.objectiveId && sh.positionName === absenceShift.positionName && sh.id !== absenceShift.id);
  const candidatesAdv = (logic.processedData || [])
    .filter((sh: any) => !sh.isPresent && !sh.isCompleted && !sh.isAbsent && !sh.isUnassigned && !sh.isFranco && sh.objectiveId === absenceShift.objectiveId && sh.positionName === absenceShift.positionName && toDate(sh.shiftDateObj) > now && isSameDay(sh.shiftDateObj, now))
    .sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime())
    .slice(0, 1);

  const candidates = byKey(step.key);

  // ── Acciones ────────────────────────────────────────────────────────────────
  const listenNotif = (notifId: string, role: 'single' | 'ext' | 'adv') => {
    if (unsubRefs[`${s.id}_${role}`]) unsubRefs[`${s.id}_${role}`]();
    unsubRefs[`${s.id}_${role}`] = onSnapshot(doc(db, 'user_notifications', notifId), snap => {
      const data = snap.data();
      if (!data) return;
      if (data.response === 'ACCEPTED') {
        if (role === 'single') onUpd({ pending: null, awaitingPhone: false });
        else if (role === 'ext') onUpd({ pendingExt: null, confirmedExt: data.userId });
        else onUpd({ pendingAdv: null, confirmedAdv: data.userId });
        toast.info('El guardia aceptó la notificación');
      } else if (data.response === 'REJECTED') {
        if (role === 'single') onUpd({ pending: null, awaitingPhone: false, status: 'SELECTING' });
        else if (role === 'ext') onUpd({ pendingExt: null });
        else onUpd({ pendingAdv: null });
        toast.info('El guardia rechazó la notificación');
      }
    });
  };

  const sendNotification = async (cand: any) => {
    const empId = cand.employeeId || cand.id;
    setLoading('notif_' + empId);
    try {
      const ref = await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
        userId: empId,
        type: 'CONVOCATORIA_COBERTURA',
        title: `Protocolo de cobertura · ${step.label}`,
        body: `Se te solicita cubrir el turno en ${absenceShift.objectiveName} (${hiStart}–${hiEnd}).`,
        objectiveId: absenceShift.objectiveId,
        shiftId: absenceShift.id || null,
        protocolStep: step.key,
        read: false,
        createdAt: serverTimestamp(),
      }, tid));
      onUpd({ status: 'PENDING', pending: { notifId: ref.id, empId, sec: step.timeoutSec }, awaitingPhone: false });
      listenNotif(ref.id, 'single');
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const confirmCandidate = async () => {
    if (!s.pending) return;
    const empId = s.pending.empId;
    const cand = (logic.employees || []).find((e: any) => e.id === empId) || (logic.processedData || []).find((sh: any) => sh.employeeId === empId);
    if (!cand) return;
    setLoading('confirm');
    try {
      const batch = writeBatch(db);
      const isReal = absenceShift.isUnassigned && absenceShift.id && !absenceShift.isVirtual;
      const markCovered = (ct: string) => { if (isReal) batch.update(doc(db, 'turnos', absenceShift.id), { status: 'COVERED', resolvedBy: 'OPERACIONES', coverageType: ct, coveredAt: serverTimestamp() }); };
      const empName = cand.fullName || cand.name || cand.employeeName || '';
      const shiftId = cand.id; // para turnos de processedData, el id del turno

      if (step.key === 'SIN_TURNO') {
        const newRef = doc(collection(db, 'turnos'));
        batch.set(newRef, stampEmpresaId({ employeeId: empId, employeeName: empName, clientId: absenceShift.clientId, clientName: absenceShift.clientName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, positionName: absenceShift.positionName, startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)), endTime: Timestamp.fromDate(absenceEnd), status: 'PENDING', origin: 'RETEN', isReten: true, absenceShiftId: absenceShift.id || null, createdAt: serverTimestamp() }, tid));
        markCovered('RETEN');
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'CONVOCATORIA_RETEN', title: 'Convocatoria retén', status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: newRef.id, description: `${empName} convocado como retén`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
      } else if (step.key === 'RET_PASIVO' || step.key === 'ESC') {
        batch.update(doc(db, 'turnos', shiftId), { coverageRedirectedTo: absenceShift.objectiveId, coverageRedirectedAt: serverTimestamp(), resolvedBy: 'OPERACIONES' });
        markCovered(step.key);
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'CONVOCATORIA_COBERTURA', title: `Cobertura ${step.label}`, status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId, description: `${empName} redirigido a cobertura en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
      } else if (step.key === 'FT') {
        batch.update(doc(db, 'turnos', shiftId), { isFranco: false, isFrancoTrabajado: true, code: 'FT', type: 'EXTRA_FRANCO', startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)), endTime: Timestamp.fromDate(absenceEnd), francoTrabajadoAt: serverTimestamp(), francoObjectiveId: absenceShift.objectiveId, francoObjectiveName: absenceShift.objectiveName, comments: `Franco Trabajado — cubre ${absenceShift.objectiveName}` });
        markCovered('FRANCO');
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId, description: `${empName} trabaja su franco`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
      }
      toast.success('Cobertura confirmada');
      onUpd({ status: 'CONFIRMED', pending: null, awaitingPhone: false });
      setTimeout(onClose, 2000);
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const rejectCandidate = () => onUpd({ status: 'SELECTING', pending: null, awaitingPhone: false });
  const skipStep = () => {
    rejectCandidate();
    const next = s.currentStep + 1;
    if (next < STEPS.length) onUpd({ currentStep: next, status: 'SELECTING', pending: null, awaitingPhone: false });
    else onUpd({ status: 'FAILED' });
  };

  const sendDual = async () => {
    if (!s.selectedExtId || !s.selectedAdvId) return;
    setLoading('dual');
    try {
      const extShift = candidatesExt.find((sh: any) => sh.id === s.selectedExtId || sh.employeeId === s.selectedExtId);
      const advShift = candidatesAdv.find((sh: any) => sh.id === s.selectedAdvId || sh.employeeId === s.selectedAdvId);
      const extEmpId = extShift?.employeeId || s.selectedExtId!;
      const advEmpId = advShift?.employeeId || s.selectedAdvId!;
      const [extRef, advRef] = await Promise.all([
        addDoc(collection(db, 'user_notifications'), stampEmpresaId({ userId: extEmpId, type: 'RETENCION', title: 'Extensión de jornada', body: `Tu turno en ${absenceShift.objectiveName} se extiende hasta ${hiEnd}.`, objectiveId: absenceShift.objectiveId, shiftId: extShift?.id || null, protocolStep: 'RETENCION_EXT', read: false, createdAt: serverTimestamp() }, tid)),
        addDoc(collection(db, 'user_notifications'), stampEmpresaId({ userId: advEmpId, type: 'ADELANTO', title: 'Adelanto de turno', body: `Tu turno en ${absenceShift.objectiveName} fue adelantado.`, objectiveId: absenceShift.objectiveId, shiftId: advShift?.id || null, protocolStep: 'RETENCION_ADV', read: false, createdAt: serverTimestamp() }, tid)),
      ]);
      onUpd({ status: 'PENDING_DUAL', pendingExt: { notifId: extRef.id, empId: extEmpId, sec: step.timeoutSec }, pendingAdv: { notifId: advRef.id, empId: advEmpId, sec: step.timeoutSec } });
      listenNotif(extRef.id, 'ext');
      listenNotif(advRef.id, 'adv');
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const confirmDual = async (role: 'ext' | 'adv') => {
    const slot = role === 'ext' ? s.pendingExt : s.pendingAdv;
    if (!slot) return;
    setLoading('confirm_' + role);
    try {
      const batch = writeBatch(db);
      if (role === 'ext') {
        const sh = candidatesExt.find((x: any) => x.employeeId === slot.empId);
        if (sh) batch.update(doc(db, 'turnos', sh.id), { isRetention: true, retentionEndTime: Timestamp.fromDate(absenceEnd) });
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'RETENCION', title: 'Retención EXT', status: 'pending', employeeId: slot.empId, employeeName: sh?.employeeName || '', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: sh?.id || null, description: `${sh?.employeeName} retenido — 1ª mitad`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
        const newConfirmedExt = slot.empId;
        if (s.confirmedAdv) { toast.success('Cobertura completa'); onUpd({ status: 'CONFIRMED', confirmedExt: newConfirmedExt, pendingExt: null }); setTimeout(onClose, 2000); }
        else onUpd({ confirmedExt: newConfirmedExt, pendingExt: null });
      } else {
        const sh = candidatesAdv.find((x: any) => x.employeeId === slot.empId);
        if (sh) batch.update(doc(db, 'turnos', sh.id), { adjustedStartTime: serverTimestamp(), isEarlyStart: true });
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'ADELANTO_TURNO', title: 'Adelanto ADV', status: 'pending', employeeId: slot.empId, employeeName: sh?.employeeName || '', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: sh?.id || null, description: `${sh?.employeeName} adelantado — 2ª mitad`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
        const newConfirmedAdv = slot.empId;
        if (s.confirmedExt) { toast.success('Cobertura completa'); onUpd({ status: 'CONFIRMED', confirmedAdv: newConfirmedAdv, pendingAdv: null }); setTimeout(onClose, 2000); }
        else onUpd({ confirmedAdv: newConfirmedAdv, pendingAdv: null });
      }
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const rejectDual = (role: 'ext' | 'adv') => {
    if (role === 'ext') onUpd({ pendingExt: null, selectedExtId: null });
    else onUpd({ pendingAdv: null, selectedAdvId: null });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderPending = () => {
    const cand = (logic.employees || []).find((e: any) => e.id === s.pending?.empId) || (logic.processedData || []).find((sh: any) => sh.employeeId === s.pending?.empId);
    const name = cand?.fullName || cand?.employeeName || cand?.name || '—';
    const phone = cand?.phone || cand?.celular || simPhone(s.pending?.empId || '');
    const timedOut = s.awaitingPhone;
    const pct = timedOut ? 0 : (s.pending?.sec ?? 0) / step.timeoutSec;
    const r = 30, circ = 2 * Math.PI * r;

    return (
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="relative w-16 h-16">
          <svg viewBox="0 0 72 72" className="w-full h-full -rotate-90">
            <circle cx="36" cy="36" r={r} fill="none" strokeWidth="5" className="stroke-slate-200" />
            <circle cx="36" cy="36" r={r} fill="none" strokeWidth="5"
              stroke={timedOut ? '#EF4444' : '#F59E0B'}
              strokeDasharray={circ.toFixed(1)} strokeDashoffset={(circ * (1 - pct)).toFixed(1)}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {timedOut ? <Phone size={18} className="text-red-500" /> : <span className="text-xs font-black font-mono text-slate-700">{fmtCd(s.pending?.sec ?? 0)}</span>}
          </div>
        </div>
        <div className={`text-xs font-bold text-center ${timedOut ? 'text-amber-700' : 'text-slate-600'}`}>
          {timedOut ? 'Sin respuesta · Llamar directamente' : 'Notificación enviada · Esperando confirmación'}
        </div>
        <div className={`w-full rounded-xl border-2 p-3 ${timedOut ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${timedOut ? 'bg-amber-200 text-amber-800' : 'bg-indigo-100 text-indigo-700'}`}>{initials(name)}</div>
            <div><div className="text-sm font-bold text-slate-800">{name}</div><div className="text-[10px] text-slate-500">{step.label}</div></div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1 text-slate-500">{timedOut ? '📞 Llamar ahora' : '📱 Teléfono'}</div>
          <div className={`text-sm font-black font-mono rounded-lg px-3 py-2 text-center ${timedOut ? 'bg-white border-2 border-amber-400 text-amber-900' : 'bg-slate-50 border border-slate-200 text-slate-800'}`}>{phone}</div>
        </div>
        <div className="w-full flex flex-col gap-1.5">
          <button onClick={confirmCandidate} disabled={!!loading} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-xl text-sm transition-colors">
            {loading === 'confirm' ? '...' : step.mandatory ? '✓ Asignado' : timedOut ? '✓ Acepta por teléfono' : '✓ Acepta'}
          </button>
          {!step.mandatory && (
            <button onClick={rejectCandidate} className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-colors">
              ✗ {timedOut ? 'No contesta / No puede' : 'Rechaza'} — siguiente
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderDual = () => {
    const isPending = s.status === 'PENDING_DUAL';
    const canNotify = !!s.selectedExtId && !!s.selectedAdvId && !isPending;

    const DualCard = ({ cand, role }: { cand: any; role: 'ext' | 'adv' }) => {
      const empId = cand.employeeId || cand.id;
      const name = cand.fullName || cand.employeeName || cand.name || '—';
      const phone = cand.phone || cand.celular || simPhone(empId);
      const isConfirmedThis = role === 'ext' ? s.confirmedExt === empId : s.confirmedAdv === empId;
      const pendingSlot = role === 'ext' ? s.pendingExt : s.pendingAdv;
      const isPendingThis = pendingSlot?.empId === empId;
      const isSelected = role === 'ext' ? s.selectedExtId === (cand.id || empId) : s.selectedAdvId === (cand.id || empId);
      const slotBusy = isPending && !isPendingThis && !isConfirmedThis;

      if (isConfirmedThis) return (
        <div className="flex items-center gap-2 p-2 rounded-xl border-2 border-emerald-400 bg-emerald-50">
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] font-black">✓</div>
          <div className="flex-1 min-w-0"><div className="text-xs font-bold text-emerald-800 truncate">{name}</div><div className="text-[10px] text-emerald-600">Confirmado</div></div>
        </div>
      );

      if (isPendingThis) return (
        <div className="flex items-center gap-2 p-2 rounded-xl border-2 border-amber-400 bg-amber-50">
          <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-[8px] font-black font-mono">{fmtCd(pendingSlot!.sec)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-amber-900 truncate">{name}</div>
            <div className="text-[10px] font-bold font-mono text-amber-800 bg-white border border-amber-300 rounded px-1 py-0.5 inline-block mt-0.5">📱 {phone}</div>
          </div>
        </div>
      );

      return (
        <div
          onClick={() => { if (slotBusy) return; const key = cand.id || empId; if (role === 'ext') onUpd({ selectedExtId: s.selectedExtId === key ? null : key }); else onUpd({ selectedAdvId: s.selectedAdvId === key ? null : key }); }}
          style={{ opacity: slotBusy ? 0.3 : 1 }}
          className={`flex items-center gap-2 p-2 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{isSelected ? '✓' : initials(name)}</div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>{name}</div>
            <div className="text-[10px] font-bold font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded px-1 py-0.5 inline-block mt-0.5">📱 {phone}</div>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] text-slate-500">{isPending ? '⏳ Esperando respuesta de cada guardia' : 'Seleccioná uno de cada columna y notificá a ambos.'}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5 bg-violet-50 border border-violet-200 rounded-xl p-2">
            <div className="text-[8px] font-black text-violet-700 uppercase tracking-wider border-b border-violet-200 pb-1">⟵ 1ª mitad · EXT</div>
            {s.confirmedExt
              ? <DualCard cand={candidatesExt.find((sh: any) => sh.employeeId === s.confirmedExt) || { id: s.confirmedExt, employeeId: s.confirmedExt }} role="ext" />
              : s.pendingExt
                ? <DualCard cand={candidatesExt.find((sh: any) => sh.employeeId === s.pendingExt!.empId) || { id: s.pendingExt.empId, employeeId: s.pendingExt.empId }} role="ext" />
                : candidatesExt.length === 0
                  ? <p className="text-[10px] text-slate-400 italic text-center py-2">Sin candidatos</p>
                  : candidatesExt.map((c: any) => <DualCard key={c.id} cand={c} role="ext" />)}
          </div>
          <div className="flex flex-col gap-1.5 bg-sky-50 border border-sky-200 rounded-xl p-2">
            <div className="text-[8px] font-black text-sky-700 uppercase tracking-wider border-b border-sky-200 pb-1">2ª mitad · ADV ⟶</div>
            {s.confirmedAdv
              ? <DualCard cand={candidatesAdv.find((sh: any) => sh.employeeId === s.confirmedAdv) || { id: s.confirmedAdv, employeeId: s.confirmedAdv }} role="adv" />
              : s.pendingAdv
                ? <DualCard cand={candidatesAdv.find((sh: any) => sh.employeeId === s.pendingAdv!.empId) || { id: s.pendingAdv.empId, employeeId: s.pendingAdv.empId }} role="adv" />
                : candidatesAdv.length === 0
                  ? <p className="text-[10px] text-slate-400 italic text-center py-2">Sin candidatos</p>
                  : candidatesAdv.map((c: any) => <DualCard key={c.id} cand={c} role="adv" />)}
          </div>
        </div>
        {isPending && (s.pendingExt || s.pendingAdv) && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-2.5">
            <div className="text-[9px] font-bold text-amber-800 uppercase mb-1.5">Resultado</div>
            <div className="flex flex-col gap-1.5">
              {s.pendingExt && !s.confirmedExt && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-violet-700 w-6">EXT</span>
                  <button onClick={() => confirmDual('ext')} disabled={!!loading} className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg">✓ Acepta</button>
                  <button onClick={() => rejectDual('ext')} disabled={!!loading} className="flex-1 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-[10px] font-bold rounded-lg">✗ Rechaza</button>
                </div>
              )}
              {s.pendingAdv && !s.confirmedAdv && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-sky-700 w-6">ADV</span>
                  <button onClick={() => confirmDual('adv')} disabled={!!loading} className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg">✓ Acepta</button>
                  <button onClick={() => rejectDual('adv')} disabled={!!loading} className="flex-1 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-[10px] font-bold rounded-lg">✗ Rechaza</button>
                </div>
              )}
            </div>
          </div>
        )}
        {!isPending && (
          <button onClick={sendDual} disabled={!canNotify || !!loading}
            className={`w-full py-2.5 font-black rounded-xl text-sm ${canNotify ? 'bg-violet-700 hover:bg-violet-800 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            {loading === 'dual' ? '...' : canNotify ? '⚡ Notificar a ambos simultáneamente' : s.selectedExtId ? 'Falta ADV →' : s.selectedAdvId ? '← Falta EXT' : 'Seleccioná uno de cada columna'}
          </button>
        )}
      </div>
    );
  };

  // ─── Panel layout ──────────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-10 right-4 z-[9000] w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden max-h-[80vh]">
      {/* Header */}
      <div className="p-3 bg-rose-600 text-white flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-black text-sm shrink-0">{(absenceShift.employeeName || 'V')[0].toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold opacity-70 uppercase tracking-wide">Protocolo CCT</div>
          <div className="font-black text-sm leading-tight truncate">{absenceShift.employeeName || 'Vacante'}</div>
          <div className="text-[10px] opacity-80 truncate">{absenceShift.objectiveName} · {hiStart}–{hiEnd}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onMinimize} className="bg-white/20 p-1 rounded-lg hover:bg-white/30 transition-colors" title="Minimizar"><Minimize2 size={13} /></button>
          <button onClick={onClose} className="bg-white/20 p-1 rounded-lg hover:bg-white/30 transition-colors" title="Cerrar"><X size={13} /></button>
        </div>
      </div>

      {/* Steps progress */}
      <div className="px-3 py-1.5 bg-rose-50 border-b border-rose-100 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0.5 min-w-max">
          {STEPS.map((st, i) => {
            const done = i < s.currentStep || s.status === 'CONFIRMED';
            const active = i === s.currentStep && s.status !== 'CONFIRMED' && s.status !== 'FAILED';
            const sec = active && s.status === 'PENDING' ? s.pending?.sec : null;
            return (
              <React.Fragment key={st.key}>
                <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black whitespace-nowrap ${done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-rose-600 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}>
                  {done ? '✓' : st.icon} {st.label}
                  {sec != null && <span className="font-mono ml-0.5">{fmtCd(sec)}</span>}
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={8} className="text-slate-300 flex-shrink-0" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {s.status === 'CONFIRMED' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={40} className="text-emerald-500" />
            <div className="font-black text-emerald-700">Cobertura confirmada</div>
          </div>
        )}
        {s.status === 'FAILED' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <AlertTriangle size={40} className="text-amber-500" />
            <div className="font-black text-amber-700">Protocolo agotado</div>
            <button onClick={() => addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'SIN_COBERTURA', title: 'Sin cobertura', status: 'pending', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName || '', positionName: absenceShift.positionName || '', description: 'Protocolo CCT agotado', createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid)).then(() => { toast.info('Registrado sin cobertura'); onClose(); })} className="px-3 py-2 bg-amber-600 text-white font-bold rounded-xl text-xs">Registrar sin cobertura</button>
          </div>
        )}
        {s.status !== 'CONFIRMED' && s.status !== 'FAILED' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Paso {s.currentStep + 1}/{STEPS.length}</div>
                <div className="text-sm font-black text-slate-800">{step.label}</div>
                {step.mandatory && <div className="text-[9px] text-orange-600 font-bold">Obligatorio</div>}
              </div>
              {s.status === 'SELECTING' && s.currentStep < STEPS.length - 1 && (
                <button onClick={skipStep} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 font-semibold">
                  <SkipForward size={11} /> Saltear
                </button>
              )}
            </div>
            {s.status === 'PENDING' ? renderPending()
              : step.isDual ? renderDual()
              : candidates.length === 0
                ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <Users size={28} className="text-slate-300" />
                    <div className="text-xs text-slate-400">Sin candidatos para este paso</div>
                    {s.currentStep < STEPS.length - 1 && (
                      <button onClick={skipStep} className="px-3 py-2 bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center gap-1"><SkipForward size={12} /> Siguiente paso</button>
                    )}
                  </div>
                )
                : candidates.map((c: any) => {
                  const empId = c.employeeId || c.id;
                  const name = c.fullName || c.employeeName || c.name || '—';
                  const phone = c.phone || c.celular || simPhone(empId);
                  return (
                    <div key={c.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white mb-2">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-600 flex-shrink-0">{initials(name)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-800 truncate">{name}</div>
                        {c.positionName && <div className="text-[9px] text-slate-400 truncate">{c.positionName}</div>}
                        <div className="text-[10px] font-bold font-mono bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 inline-block mt-1 text-slate-700">📱 {phone}</div>
                      </div>
                      <button onClick={() => sendNotification(c)} disabled={!!loading || s.status !== 'SELECTING'} className="px-2.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg whitespace-nowrap">
                        {loading === 'notif_' + empId ? '...' : 'Notificar'}
                      </button>
                    </div>
                  );
                })
            }
          </div>
        )}
      </div>
    </div>
  );
}
