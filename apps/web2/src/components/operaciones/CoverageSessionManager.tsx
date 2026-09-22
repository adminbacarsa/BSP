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
  AlertTriangle, Users, Clock, Minimize2, Search,
} from 'lucide-react';
import {
  collection, doc, addDoc, writeBatch, serverTimestamp, Timestamp, onSnapshot, getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import {
  absentShiftCoveragePatch,
  syncAusenciaCoberturaGestionada,
  isTitularAlreadyCovered,
  opsCoverageLinkFields,
  supersedeOpsCoveragesForAbsence,
} from '@/lib/operaciones/syncAusenciaCobertura';
import { toast } from 'sonner';
import { collectFrancoShiftRowsToday } from '@/lib/operaciones/coverageAssignedToday';
import {
  buildOpsDualCoverageTurnoPatches,
  opsPositionMatches,
} from '@/lib/operaciones/opsDualCoverageApply';
import {
  listOpsAdvCandidatesForVacancy,
  listOpsExtCandidatesForVacancy,
} from '@/lib/operaciones/opsExtAdvCandidates';
import {
  buildInternalCoverageCandidates,
  type InternalCoverageCandidate,
  type InternalCoverageKind,
} from '@/lib/operaciones/coverageInternalCandidates';
import { applyAutoRetentionForGap } from '@/lib/operaciones/coverageRetention';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type StepKey = 'INTERNO' | 'RETENCION' | 'FT';

export interface PendingSlot {
  notifId: string;
  empId: string;
  sec: number;
  shiftId?: string;
  coverageKind?: InternalCoverageKind;
}

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
  retentionShiftId?: string | null;
  retentionEmployeeName?: string | null;
  autoRetentionApplied?: boolean;
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

// ─── Constantes ───────────────────────────────────────────────────────────────

const STEPS: { key: StepKey; label: string; icon: string; mandatory: boolean; timeoutSec: number; isDual?: boolean; desc: string }[] = [
  { key: 'INTERNO', label: 'RET · REF · ESC', icon: '1', mandatory: true, timeoutSec: 180, desc: 'Plantel del objetivo — prioridad RET, luego REF y ESC' },
  { key: 'RETENCION', label: 'Ext + Adel', icon: '2', mandatory: false, timeoutSec: 60, isDual: true, desc: 'Extensión + adelanto (costo extra). Solo gente del objetivo' },
  { key: 'FT', label: 'Franco Trabajado', icon: '3', mandatory: false, timeoutSec: 180, desc: 'Último recurso' },
];

const BAND_LABEL: Record<string, string> = {
  M: 'Mañana', T: 'Tarde', N: 'Noche', D12: '12h diurno', N12: '12h nocturno',
  RET: 'Retención', ESC: 'Escuela', REF: 'Refuerzo', FT: 'Franco trab.',
  F: 'Franco', FF: 'Franco feriado', FP: 'Franco permuta',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCd = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
const toDate = (d: any): Date => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const fmtTime = (d: any) => { try { return toDate(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch { return '--:--'; } };
const isSameDay = (d1: any, d2: any) => toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA');
const simPhone = (id: string) => { const n = parseInt(id.replace(/\D/g, '')) || 1; return `+54 9 351 ${String(n * 1317 % 10000).padStart(4, '0')}-${String(n * 7531 % 10000).padStart(4, '0')}`; };
const initials = (name: string) => (name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
const normBandCode = (c: unknown) => String(c || '').trim().toUpperCase();

const resolveCoverageShiftForEmployee = (
  processedData: any[],
  employeeId: string,
  stepKey: StepKey,
  now: Date,
  rawShifts?: any[],
  internalKind?: InternalCoverageKind,
): any | null => {
  const eid = String(employeeId || '').trim();
  if (!eid) return null;
  if (stepKey === 'FT') {
    return collectFrancoShiftRowsToday(rawShifts, processedData, now)
      .find((sh: any) => String(sh.employeeId || '').trim() === eid) || null;
  }
  const todayRows = (processedData || []).filter(
    (sh: any) => String(sh.employeeId || '').trim() === eid && isSameDay(sh.shiftDateObj, now),
  );
  if (stepKey === 'INTERNO' && internalKind) {
    return (
      todayRows.find((sh: any) => normBandCode(sh.code) === internalKind && !sh.isAbsent && sh.isVirtual !== true)
      || null
    );
  }
  return null;
};

/** Retención automática + metadatos en sesión al abrir protocolo. */
export async function bootstrapCoverageSession(
  absentShift: any,
  processedData: unknown[],
  empresaId: string,
): Promise<Partial<CoverageSession>> {
  const tid = String(empresaId || absentShift?.empresaId || '').trim();
  if (!tid || !absentShift) return {};
  try {
    const result = await applyAutoRetentionForGap(db, absentShift, processedData, tid);
    if (result.pick) {
      if (result.applied) {
        toast.info(`${result.pick.employeeName} retenido en puesto (último en fichar)`);
      }
      return {
        retentionShiftId: result.pick.shiftId,
        retentionEmployeeName: result.pick.employeeName,
        autoRetentionApplied: result.applied,
      };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    toast.error('No se pudo aplicar retención automática: ' + msg);
  }
  return {};
}

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
    retentionShiftId: null,
    retentionEmployeeName: null,
    autoRetentionApplied: false,
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
  const timerRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const unsubRefs = useRef<Record<string, () => void>>({});

  const upd = useCallback((id: string, patch: Partial<CoverageSession>) => {
    onUpdate(id, s => ({ ...s, ...patch }));
  }, [onUpdate]);

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
              const tick = (slot: PendingSlot | null) =>
                slot && slot.sec > 0 ? { ...slot, sec: slot.sec - 1 } : slot;
              const newExt = tick(sess.pendingExt);
              const newAdv = tick(sess.pendingAdv);
              const sharedSec = Math.min(newExt?.sec ?? 0, newAdv?.sec ?? 0);
              return {
                ...sess,
                pendingExt: newExt,
                pendingAdv: newAdv,
                awaitingPhone: sharedSec <= 0 ? true : sess.awaitingPhone,
              };
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
    Object.keys(timerRefs.current).forEach(id => {
      if (!sessions.find(s => s.id === id)) {
        clearInterval(timerRefs.current[id]);
        delete timerRefs.current[id];
      }
    });
  }, [sessions, onUpdate]);

  useEffect(() => () => {
    Object.values(timerRefs.current).forEach(clearInterval);
    Object.values(unsubRefs.current).forEach(fn => fn());
  }, []);

  if (sessions.length === 0) return null;

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  return (
    <>
      {activeSession && !activeSession.minimized && (
        <CoveragePanel
          key={activeSession.id}
          session={activeSession}
          allSessions={sessions}
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
            const band = s.absentShift?.code || '';

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
                <span className="text-[11px]">
                  {isConfirmed ? '✓' : isFailed ? '✗' : isPending ? (s.awaitingPhone ? '📞' : '⏳') : '●'}
                </span>
                <span className="max-w-[90px] truncate">
                  {(s.absentShift.employeeName || 'Vacante').split(',')[0]}
                </span>
                {band && <span className="text-[9px] opacity-70 bg-black/20 rounded px-1">{band}</span>}
                {isPending && sec < 999 && (
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${sec <= 10 ? 'bg-red-700' : 'bg-black/20'}`}>
                    {fmtCd(sec)}
                  </span>
                )}
                {!isConfirmed && !isFailed && (
                  <span className="text-[9px] opacity-70">P{s.currentStep + 1}</span>
                )}
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
  allSessions: CoverageSession[];
  logic: any;
  onUpd: (patch: Partial<CoverageSession>) => void;
  onClose: () => void;
  onMinimize: () => void;
  unsubRefs: Record<string, () => void>;
}

function CoveragePanel({ session: s, allSessions, logic, onUpd, onClose, onMinimize, unsubRefs }: PanelProps) {
  const [loading, setLoading] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  // Refs para siempre apuntar a la versión más reciente de las funciones de confirmación
  // y evitar closures stale en los callbacks de onSnapshot
  const confirmCandidateRef = useRef<() => Promise<void>>(async () => {});
  const confirmDualTogetherRef = useRef<() => Promise<void>>(async () => {});
  const tid = s.empresaId;
  const absenceShift = s.absentShift;
  const step = STEPS[s.currentStep];
  const now = new Date();
  const absenceEnd = toDate(absenceShift.endDateObj);
  const hiStart = fmtTime(absenceShift.shiftDateObj);
  const hiEnd = fmtTime(absenceShift.endDateObj);
  const bandCode = absenceShift.code || '';
  const bandLabel = BAND_LABEL[bandCode] || bandCode;

  // ── Candidatos ─────────────────────────────────────────────────────────────

  // Empleados ocupados en otras sesiones activas (evita proponer el mismo candidato en paralelo)
  const crossSessionBusy = new Set<string>(
    allSessions
      .filter(sess => sess.id !== s.id)
      .flatMap(sess => [
        sess.pending?.empId,
        sess.pendingExt?.empId,
        sess.pendingAdv?.empId,
        sess.confirmedExt,
        sess.confirmedAdv,
      ].filter(Boolean) as string[])
  );

  const internalGroups = buildInternalCoverageCandidates(
    logic.processedData || [],
    logic.employees || [],
    absenceShift,
    now,
    crossSessionBusy,
  );

  const ftCandidates = step.key === 'FT'
    ? collectFrancoShiftRowsToday(logic.rawShifts, logic.processedData, now)
      .filter((sh: any) => !crossSessionBusy.has(sh.employeeId))
      .map((sh: any) => {
        const emp = (logic.employees || []).find((e: any) => e.id === sh.employeeId);
        return {
          ...sh,
          fullName: sh.employeeName || emp?.fullName || emp?.name || '',
          phone: sh.phone || emp?.phone || emp?.celular || '',
        };
      })
    : [];

  const candidatesExt = listOpsExtCandidatesForVacancy(
    logic.processedData || [],
    absenceShift,
    now,
    crossSessionBusy,
  );
  const candidatesAdv = listOpsAdvCandidatesForVacancy(
    logic.processedData || [],
    absenceShift,
    now,
    crossSessionBusy,
  );

  const filterInternal = (list: InternalCoverageCandidate[]) => {
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((c) => c.fullName.toLowerCase().includes(q));
  };

  const internalFiltered = {
    ret: filterInternal(internalGroups.ret),
    ref: filterInternal(internalGroups.ref),
    esc: filterInternal(internalGroups.esc),
  };
  const internalCount =
    internalGroups.ret.length + internalGroups.ref.length + internalGroups.esc.length;

  const ftFiltered = search.trim()
    ? ftCandidates.filter((c: any) =>
      (c.fullName || c.employeeName || '').toLowerCase().includes(search.trim().toLowerCase()))
    : ftCandidates;

  // ── Acciones ────────────────────────────────────────────────────────────────
  const listenNotif = (notifId: string, role: 'single' | 'ext' | 'adv') => {
    if (unsubRefs[`${s.id}_${role}`]) unsubRefs[`${s.id}_${role}`]();
    let handled = false;
    unsubRefs[`${s.id}_${role}`] = onSnapshot(doc(db, 'user_notifications', notifId), snap => {
      const data = snap.data();
      if (!data || handled) return;
      if (data.response === 'ACCEPTED') {
        handled = true;
        toast.info('El guardia aceptó — confirmando automáticamente');
        if (role === 'single') void confirmCandidateRef.current();
        else if (role === 'ext' || role === 'adv') void confirmDualTogetherRef.current();
      } else if (data.response === 'REJECTED') {
        handled = true;
        if (role === 'single') onUpd({ pending: null, awaitingPhone: false, status: 'SELECTING' });
        else if (role === 'ext') onUpd({ pendingExt: null });
        else onUpd({ pendingAdv: null });
        toast.info('El guardia rechazó la notificación');
      }
    });
  };

  const sendNotification = async (cand: InternalCoverageCandidate | Record<string, unknown>) => {
    const internal = cand as InternalCoverageCandidate;
    const empId = String(internal.employeeId || (cand as any).employeeId || (cand as any).id || '').trim();
    const coverageKind = internal.coverageKind as InternalCoverageKind | undefined;
    const kindLabel = coverageKind || step.key;
    setLoading('notif_' + empId);
    try {
      const ref = await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
        employeeId: empId,
        userId: empId,
        type: 'CONVOCATORIA_COBERTURA',
        title: `Cobertura ${kindLabel} · ${absenceShift.objectiveName || 'objetivo'}`,
        body: `Cubrir ${hiStart}–${hiEnd} en ${[absenceShift.positionName, absenceShift.objectiveName].filter(Boolean).join(' · ')}.`,
        objectiveId: absenceShift.objectiveId,
        objectiveName: absenceShift.objectiveName || null,
        positionName: absenceShift.positionName || null,
        clientId: absenceShift.clientId || null,
        clientName: absenceShift.clientName || null,
        shiftCode: absenceShift.code || null,
        shiftId: absenceShift.id || null,
        startTime: absenceShift.shiftDateObj || null,
        endTime: absenceEnd || null,
        protocolStep: coverageKind || step.key,
        read: false,
        createdAt: serverTimestamp(),
      }, tid));
      const turnoId =
        internal.id && String(internal.id) !== empId
          ? String(internal.id)
          : resolveCoverageShiftForEmployee(
            logic.processedData || [],
            empId,
            step.key,
            now,
            logic.rawShifts,
            coverageKind,
          )?.id;
      onUpd({
        status: 'PENDING',
        pending: {
          notifId: ref.id,
          empId,
          sec: step.timeoutSec,
          shiftId: turnoId || undefined,
          coverageKind,
        },
        awaitingPhone: false,
      });
      listenNotif(ref.id, 'single');
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const confirmCandidate = async () => {
    if (!s.pending) return;
    const empId = s.pending.empId;
    const coverageShift =
      (s.pending.shiftId
        ? (logic.processedData || []).find((sh: any) => sh.id === s.pending!.shiftId)
        : null)
      || resolveCoverageShiftForEmployee(
        logic.processedData || [],
        empId,
        step.key,
        now,
        logic.rawShifts,
        s.pending?.coverageKind,
      );
    const empRow = (logic.employees || []).find((e: any) => e.id === empId);
    const cand = coverageShift || empRow || (logic.processedData || []).find((sh: any) => sh.employeeId === empId);
    if (!cand) return;
    setLoading('confirm');
    try {
      // Idempotencia: si la ausencia ya tiene cobertura activa, no crear otra (evita N COB en Plan).
      if (absenceShift.id) {
        const titularSnap = await getDoc(doc(db, 'turnos', absenceShift.id));
        if (titularSnap.exists() && isTitularAlreadyCovered(titularSnap.data() as Record<string, unknown>)) {
          toast.message('Esta ausencia ya tiene cobertura activa — no se crea otra.');
          onUpd({ status: 'CONFIRMED', pending: null, awaitingPhone: false });
          setTimeout(onClose, 1200);
          return;
        }
      }

      const batch = writeBatch(db);
      if (absenceShift.id) {
        await supersedeOpsCoveragesForAbsence(db, absenceShift.id, batch, {
          supersededBy: `SESSION_${s.id}`,
        });
      }
      const isAbsence =
        !!(absenceShift.isAbsent || absenceShift.isPotentialAbsence || absenceShift.absenceType);
      const canMarkTitular =
        !!absenceShift.id &&
        !absenceShift.isVirtual &&
        (absenceShift.isUnassigned || isAbsence);
      const displayName =
        cand.fullName
        || cand.name
        || cand.employeeName
        || (empRow ? `${empRow.firstName || ''} ${empRow.lastName || ''}`.trim() : '')
        || 'Guardia';

      let shiftId: string | null = String(s.pending.shiftId || coverageShift?.id || '').trim() || null;
      if (!shiftId || shiftId === empId) {
        const resolved = resolveCoverageShiftForEmployee(
          logic.processedData || [],
          empId,
          step.key,
          now,
          logic.rawShifts,
          s.pending.coverageKind,
        );
        shiftId = resolved?.id ? String(resolved.id) : null;
      }
      if (!shiftId) {
        toast.error('No se encontró el turno de hoy del guardia en la malla. Recargá operaciones.');
        return;
      }
      const turnoSnap = await getDoc(doc(db, 'turnos', shiftId));
      if (!turnoSnap.exists()) {
        toast.error('El turno del guardia ya no existe en Firestore. Recargá operaciones e intentá de nuevo.');
        return;
      }
      const linkFields = opsCoverageLinkFields(
        {
          employeeId: absenceShift.employeeId,
          employeeName: absenceShift.employeeName,
        },
        String(absenceShift.id || ''),
      );
      // coveredBy* en el turno ausente alimenta "CUBIERTO POR" en planificación y reportes
      const markCovered = (ct: string) => {
        if (!canMarkTitular) return;
        batch.update(
          doc(db, 'turnos', absenceShift.id),
          absentShiftCoveragePatch({
            coveredByEmployeeId: empId,
            coveredByEmployeeName: displayName,
            coverageType: ct,
            isAbsence,
          }),
        );
      };

      if (step.key === 'INTERNO') {
        const ct = s.pending.coverageKind || 'RET';
        batch.update(doc(db, 'turnos', shiftId!), {
          coverageRedirectedTo: absenceShift.objectiveId,
          coverageRedirectedAt: serverTimestamp(),
          resolvedBy: 'OPERACIONES',
        });
        markCovered(ct);
        if (absenceShift.id) {
          await syncAusenciaCoberturaGestionada(
            db,
            {
              shiftId: absenceShift.id,
              coveredByEmployeeId: empId,
              coveredByEmployeeName: displayName,
              coverageType: ct,
              empresaId: tid || null,
            },
            batch,
          );
        }
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({
          type: 'CONVOCATORIA_COBERTURA',
          title: `Cobertura ${ct}`,
          status: 'pending',
          employeeId: empId,
          employeeName: displayName,
          objectiveId: absenceShift.objectiveId,
          objectiveName: absenceShift.objectiveName,
          shiftId,
          description: `${displayName} (${ct}) convocado a cubrir ${hiStart}–${hiEnd} en ${absenceShift.objectiveName}`,
          createdAt: serverTimestamp(),
          reportedBy: 'OPERACIONES',
        }, tid));
      } else if (step.key === 'FT') {
        batch.update(doc(db, 'turnos', shiftId!), {
          isFranco: false,
          isFrancoTrabajado: true,
          code: 'FT',
          type: 'EXTRA_FRANCO',
          startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)),
          endTime: Timestamp.fromDate(absenceEnd),
          francoTrabajadoAt: serverTimestamp(),
          francoObjectiveId: absenceShift.objectiveId,
          francoObjectiveName: absenceShift.objectiveName,
          comments: `Franco Trabajado — cubre ${absenceShift.employeeName || absenceShift.objectiveName}`,
          origin: 'OPERATIONS_COVERAGE',
          resolvedBy: 'OPERACIONES',
          ...linkFields,
        });
        markCovered('FRANCO');
        if (absenceShift.id) {
          await syncAusenciaCoberturaGestionada(
            db,
            {
              shiftId: absenceShift.id,
              coveredByEmployeeId: empId,
              coveredByEmployeeName: displayName,
              coverageType: 'FT',
              empresaId: tid || null,
            },
            batch,
          );
        }
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', status: 'pending', employeeId: empId, employeeName: displayName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId, description: `${displayName} trabaja su franco`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
      }
      toast.success('Cobertura confirmada');
      onUpd({ status: 'CONFIRMED', pending: null, awaitingPhone: false });
      setTimeout(onClose, 2000);
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };
  // Mantener ref siempre actualizado (evita closures stale en onSnapshot)
  confirmCandidateRef.current = confirmCandidate;

  const rejectCandidate = () => onUpd({ status: 'SELECTING', pending: null, awaitingPhone: false });
  const skipStep = () => {
    rejectCandidate();
    const next = s.currentStep + 1;
    if (next < STEPS.length) onUpd({ currentStep: next, status: 'SELECTING', pending: null, awaitingPhone: false });
    else onUpd({ status: 'FAILED' });
  };

  const startDualContact = () => {
    if (!s.selectedExtId || !s.selectedAdvId) return;
    const extShift = candidatesExt.find((sh: any) => sh.id === s.selectedExtId || sh.employeeId === s.selectedExtId);
    const advShift = candidatesAdv.find((sh: any) => sh.id === s.selectedAdvId || sh.employeeId === s.selectedAdvId);
    const extEmpId = extShift?.employeeId || s.selectedExtId!;
    const advEmpId = advShift?.employeeId || s.selectedAdvId!;
    onUpd({
      status: 'PENDING_DUAL',
      awaitingPhone: false,
      pendingExt: {
        notifId: '',
        empId: extEmpId,
        sec: step.timeoutSec,
        shiftId: extShift?.id,
      },
      pendingAdv: {
        notifId: '',
        empId: advEmpId,
        sec: step.timeoutSec,
        shiftId: advShift?.id,
      },
    });
  };

  const confirmDualTogether = async () => {
    if (!s.pendingExt || !s.pendingAdv) return;
    const nextExt = s.pendingExt.empId;
    const nextAdv = s.pendingAdv.empId;
    setLoading('confirm_dual');
    try {
      if (absenceShift.id) {
        const titularSnap = await getDoc(doc(db, 'turnos', absenceShift.id));
        if (titularSnap.exists() && isTitularAlreadyCovered(titularSnap.data() as Record<string, unknown>)) {
          toast.message('Esta ausencia ya tiene cobertura activa — no se duplica.');
          onUpd({
            status: 'CONFIRMED',
            confirmedExt: nextExt,
            confirmedAdv: nextAdv,
            pendingExt: null,
            pendingAdv: null,
          });
          setTimeout(onClose, 1200);
          return;
        }
      }

      const { patchesByDocId, coveredByLabel } = buildOpsDualCoverageTurnoPatches({
        absenceShift,
        extEmpId: nextExt,
        advEmpId: nextAdv,
        processedData: logic.processedData || [],
        rawShifts: logic.rawShifts,
        employees: logic.employees || [],
        servicesSLA: logic.servicesSLA || [],
      });

      const batch = writeBatch(db);
      if (absenceShift.id) {
        await supersedeOpsCoveragesForAbsence(db, absenceShift.id, batch, {
          supersededBy: `SESSION_DUAL_${s.id}`,
        });
        const isAbsence = !!(absenceShift.isAbsent || absenceShift.isPotentialAbsence || absenceShift.absenceType);
        batch.update(
          doc(db, 'turnos', absenceShift.id),
          absentShiftCoveragePatch({
            coveredByEmployeeId: nextExt,
            coveredByEmployeeName: coveredByLabel,
            coverageType: 'RETENCION',
            isAbsence,
          }),
        );
        await syncAusenciaCoberturaGestionada(
          db,
          {
            shiftId: absenceShift.id,
            coveredByEmployeeId: nextExt,
            coveredByEmployeeName: coveredByLabel,
            coverageType: 'RETENCION',
            empresaId: tid || null,
          },
          batch,
        );
      }
      patchesByDocId.forEach((patch, docId) => {
        batch.update(doc(db, 'turnos', docId), patch);
      });
      await batch.commit();

      const extSh = candidatesExt.find((x: any) => x.employeeId === nextExt);
      const advSh = candidatesAdv.find((x: any) => x.employeeId === nextAdv);
      await addDoc(
        collection(db, 'novedades'),
        stampEmpresaId(
          {
            type: 'COBERTURA_ASIGNADA',
            title: 'Cobertura EXT + ADV',
            status: 'pending',
            employeeId: nextExt,
            employeeName: coveredByLabel,
            objectiveId: absenceShift.objectiveId,
            objectiveName: absenceShift.objectiveName,
            shiftId: absenceShift.id || extSh?.id || null,
            description: `Split ${coveredByLabel} · ${absenceShift.objectiveName} (${hiStart}–${hiEnd})`,
            createdAt: serverTimestamp(),
            reportedBy: 'OPERACIONES',
          },
          tid,
        ),
      );
      await addDoc(
        collection(db, 'novedades'),
        stampEmpresaId(
          {
            type: 'RETENCION',
            title: 'Retención EXT',
            status: 'pending',
            employeeId: nextExt,
            employeeName: extSh?.employeeName || '',
            objectiveId: absenceShift.objectiveId,
            objectiveName: absenceShift.objectiveName,
            shiftId: extSh?.id || null,
            description: `${extSh?.employeeName || 'EXT'} — 1ª mitad`,
            createdAt: serverTimestamp(),
            reportedBy: 'OPERACIONES',
          },
          tid,
        ),
      );
      await addDoc(
        collection(db, 'novedades'),
        stampEmpresaId(
          {
            type: 'ADELANTO_TURNO',
            title: 'Adelanto ADV',
            status: 'pending',
            employeeId: nextAdv,
            employeeName: advSh?.employeeName || '',
            objectiveId: absenceShift.objectiveId,
            objectiveName: absenceShift.objectiveName,
            shiftId: advSh?.id || null,
            description: `${advSh?.employeeName || 'ADV'} — 2ª mitad`,
            createdAt: serverTimestamp(),
            reportedBy: 'OPERACIONES',
          },
          tid,
        ),
      );

      toast.success('Cobertura EXT+ADV aplicada (Plan + Ops)');
      onUpd({
        status: 'CONFIRMED',
        confirmedExt: nextExt,
        confirmedAdv: nextAdv,
        pendingExt: null,
        pendingAdv: null,
      });
      setTimeout(onClose, 2000);
    } catch (e: any) {
      toast.error('Error al confirmar cobertura: ' + (e?.message || String(e)));
    } finally {
      setLoading(null);
    }
  };

  confirmDualTogetherRef.current = confirmDualTogether;

  const rejectDualTogether = () => {
    onUpd({
      status: 'SELECTING',
      pendingExt: null,
      pendingAdv: null,
      awaitingPhone: false,
      confirmedExt: null,
      confirmedAdv: null,
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderPending = () => {
    const cand = (logic.employees || []).find((e: any) => e.id === s.pending?.empId) || (logic.processedData || []).find((sh: any) => sh.employeeId === s.pending?.empId);
    const name = cand?.fullName || cand?.employeeName || cand?.name || '—';
    const phone = cand?.phone || cand?.celular || simPhone(s.pending?.empId || '');
    const timedOut = s.awaitingPhone;
    const pct = timedOut ? 0 : (s.pending?.sec ?? 0) / step.timeoutSec;
    const r = 32, circ = 2 * Math.PI * r;

    return (
      <div className="flex flex-col items-center gap-3 py-2">
        {/* Countdown ring */}
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
            <circle cx="38" cy="38" r={r} fill="none" strokeWidth="5" stroke="currentColor" className="text-slate-100" />
            <circle cx="38" cy="38" r={r} fill="none" strokeWidth="5"
              stroke={timedOut ? '#EF4444' : '#F59E0B'}
              strokeDasharray={circ.toFixed(1)} strokeDashoffset={(circ * (1 - pct)).toFixed(1)}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {timedOut
              ? <Phone size={20} className="text-red-500" />
              : <span className="text-sm font-black font-mono text-slate-700">{fmtCd(s.pending?.sec ?? 0)}</span>}
          </div>
        </div>
        <div className={`text-xs font-semibold text-center leading-snug ${timedOut ? 'text-red-600' : 'text-slate-500'}`}>
          {timedOut ? 'Sin respuesta — llamar directamente' : 'Notificación enviada · esperando respuesta'}
        </div>

        {/* Tarjeta del candidato */}
        <div className={`w-full rounded-2xl border-2 p-3.5 ${timedOut ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${timedOut ? 'bg-amber-200 text-amber-800' : 'bg-indigo-100 text-indigo-700'}`}>{initials(name)}</div>
            <div>
              <div className="text-sm font-black text-slate-800 leading-tight">{name}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{step.label}</div>
            </div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
            {timedOut ? '📞 LLAMAR AHORA' : '📱 TELÉFONO'}
          </div>
          <div className={`text-base font-black font-mono tracking-wider rounded-xl px-4 py-2.5 text-center ${timedOut ? 'bg-white border-2 border-amber-400 text-amber-900' : 'bg-white border border-slate-300 text-slate-800'}`}>
            {phone}
          </div>
        </div>

        {/* Acciones */}
        <div className="w-full flex flex-col gap-2">
          <button onClick={confirmCandidate} disabled={!!loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-2xl text-sm transition-colors shadow-sm">
            {loading === 'confirm' ? '...' : timedOut ? '✓ Acepta por teléfono' : '✓ Acepta'}
          </button>
          <button onClick={rejectCandidate}
            className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-2xl text-sm transition-colors">
            {timedOut ? '✗ No contesta / No puede' : '✗ Rechaza'} — siguiente
          </button>
        </div>
      </div>
    );
  };

  const renderDual = () => {
    const isPending = s.status === 'PENDING_DUAL';
    const canStart = !!s.selectedExtId && !!s.selectedAdvId && !isPending;
    const dualSec = Math.min(s.pendingExt?.sec ?? step.timeoutSec, s.pendingAdv?.sec ?? step.timeoutSec);
    const timedOut = isPending && (s.awaitingPhone || dualSec <= 0);
    const pct = timedOut ? 0 : dualSec / step.timeoutSec;
    const r = 32;
    const circ = 2 * Math.PI * r;

    const resolveCand = (role: 'ext' | 'adv', empId: string) => {
      const pool = role === 'ext' ? candidatesExt : candidatesAdv;
      return pool.find((sh: any) => sh.employeeId === empId) || { employeeId: empId, id: empId };
    };

    const shiftSubtitle = (cand: any) => {
      const code = normBandCode(cand.code);
      if (!cand.shiftDateObj && !code) return null;
      const band = code ? `${code}${BAND_LABEL[code] && BAND_LABEL[code] !== code ? ` · ${BAND_LABEL[code]}` : ''}` : '';
      const times = cand.shiftDateObj
        ? `${fmtTime(cand.shiftDateObj)}–${fmtTime(cand.endDateObj)}`
        : '';
      return [band, times].filter(Boolean).join(' · ') || null;
    };

    const DualCard = ({ cand, role }: { cand: any; role: 'ext' | 'adv' }) => {
      const empId = cand.employeeId || cand.id;
      const name = cand.fullName || cand.employeeName || cand.name || '—';
      const phone = cand.phone || cand.celular || simPhone(empId);
      const sub = shiftSubtitle(cand);
      const pendingSlot = role === 'ext' ? s.pendingExt : s.pendingAdv;
      const isPendingThis = isPending && pendingSlot?.empId === empId;
      const isSelected = role === 'ext' ? s.selectedExtId === (cand.id || empId) : s.selectedAdvId === (cand.id || empId);
      const slotBusy = isPending && !isPendingThis;

      if (isPendingThis) {
        return (
          <div className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-amber-400 bg-amber-50">
            <div className="w-7 h-7 rounded-full bg-amber-200 flex items-center justify-center text-amber-900 text-[10px] font-black flex-shrink-0">
              {role === 'ext' ? 'EXT' : 'ADV'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-amber-900 truncate">{name}</div>
              {sub && <div className="text-[10px] font-semibold text-amber-800 truncate">{sub}</div>}
              <div className="text-xs font-black font-mono text-amber-800">📱 {phone}</div>
            </div>
          </div>
        );
      }

      return (
        <div
          onClick={() => {
            if (isPending) return;
            const key = cand.id || empId;
            if (role === 'ext') onUpd({ selectedExtId: s.selectedExtId === key ? null : key });
            else onUpd({ selectedAdvId: s.selectedAdvId === key ? null : key });
          }}
          style={{ opacity: slotBusy ? 0.35 : 1 }}
          className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all ${isPending ? 'cursor-default' : 'cursor-pointer'} ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{isSelected ? '✓' : initials(name)}</div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>{name}</div>
            {sub && <div className="text-[10px] font-semibold text-slate-600 truncate">{sub}</div>}
            <div className="text-xs font-mono text-slate-600">📱 {phone}</div>
          </div>
        </div>
      );
    };

    const extEmpId = isPending ? s.pendingExt?.empId : null;
    const advEmpId = isPending ? s.pendingAdv?.empId : null;

    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs text-slate-500 leading-snug">
          {isPending
            ? (timedOut ? '📞 Llamá a EXT y ADV — deben aceptar juntos' : 'Contacto telefónico · aceptación conjunta (sin push al portal)')
            : 'Seleccioná EXT (cierra cuando arranca la vacante) y ADV (próximo turno).'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5 bg-violet-50 border border-violet-200 rounded-xl p-2">
            <div className="text-[9px] font-black text-violet-700 uppercase tracking-wider border-b border-violet-200 pb-1.5 mb-0.5">⟵ 1ª mitad · EXT</div>
            {isPending && extEmpId
              ? <DualCard cand={resolveCand('ext', extEmpId)} role="ext" />
              : candidatesExt.length === 0
                ? <p className="text-[10px] text-slate-400 italic text-center py-2">Sin candidatos (turno que cierra al inicio de la vacante)</p>
                : candidatesExt.map((c: any) => <DualCard key={c.id} cand={c} role="ext" />)}
          </div>
          <div className="flex flex-col gap-1.5 bg-sky-50 border border-sky-200 rounded-xl p-2">
            <div className="text-[9px] font-black text-sky-700 uppercase tracking-wider border-b border-sky-200 pb-1.5 mb-0.5">2ª mitad · ADV ⟶</div>
            {isPending && advEmpId
              ? <DualCard cand={resolveCand('adv', advEmpId)} role="adv" />
              : candidatesAdv.length === 0
                ? <p className="text-[10px] text-slate-400 italic text-center py-2">Sin candidatos</p>
                : candidatesAdv.map((c: any) => <DualCard key={c.id} cand={c} role="adv" />)}
          </div>
        </div>
        {isPending && s.pendingExt && s.pendingAdv && (
          <div className="flex flex-col items-center gap-3 py-1">
            <div className="relative w-20 h-20">
              <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
                <circle cx="38" cy="38" r={r} fill="none" strokeWidth="5" stroke="currentColor" className="text-slate-100" />
                <circle cx="38" cy="38" r={r} fill="none" strokeWidth="5"
                  stroke={timedOut ? '#EF4444' : '#F59E0B'}
                  strokeDasharray={circ.toFixed(1)} strokeDashoffset={(circ * (1 - pct)).toFixed(1)}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                {timedOut
                  ? <Phone size={20} className="text-red-500" />
                  : <span className="text-sm font-black font-mono text-slate-700">{fmtCd(dualSec)}</span>}
              </div>
            </div>
            <div className={`text-xs font-semibold text-center leading-snug ${timedOut ? 'text-red-600' : 'text-slate-500'}`}>
              {timedOut ? 'Sin respuesta en tiempo — confirmá por teléfono si ambos aceptan' : 'Tiempo de contacto · ambos deben aceptar'}
            </div>
            <div className="w-full flex flex-col gap-2">
              <button onClick={() => void confirmDualTogether()} disabled={!!loading}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-2xl text-sm transition-colors shadow-sm">
                {loading === 'confirm_dual' ? '...' : timedOut ? '✓ Ambos aceptan (teléfono)' : '✓ Ambos aceptan'}
              </button>
              <button onClick={rejectDualTogether} disabled={!!loading}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-2xl text-sm transition-colors">
                ✗ No pueden / volver a elegir
              </button>
            </div>
          </div>
        )}
        {!isPending && (
          <button onClick={startDualContact} disabled={!canStart || !!loading}
            className={`w-full py-3 font-black rounded-2xl text-sm transition-colors shadow-sm ${canStart ? 'bg-violet-700 hover:bg-violet-800 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            {canStart ? '📞 Iniciar contacto EXT + ADV' : s.selectedExtId ? 'Falta ADV →' : s.selectedAdvId ? '← Falta EXT' : 'Seleccioná uno de cada columna'}
          </button>
        )}
      </div>
    );
  };

  const renderInternalBlock = (
    title: string,
    badgeClass: string,
    list: InternalCoverageCandidate[],
  ) => {
    if (!list.length) return null;
    return (
      <div className="mb-3">
        <div className={`text-[10px] font-black uppercase tracking-wide mb-1.5 px-1 ${badgeClass}`}>{title}</div>
        <div className="flex flex-col gap-2">
          {list.map((c) => {
            const phone = c.phone || simPhone(c.employeeId);
            const isNotifying = loading === 'notif_' + c.employeeId;
            return (
              <div key={`${c.coverageKind}_${c.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">
                  {c.coverageKind}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">{c.fullName}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {c.positionName ? `${c.positionName} · ` : ''}{c.code}
                  </div>
                  <div className={`text-[10px] font-bold mt-0.5 ${c.knowsObjective ? 'text-indigo-600' : 'text-amber-600'}`}>
                    {c.knowsObjective ? `Conoce: ${c.knowledgeLabel}` : 'Sin historial en objetivo'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">{phone}</div>
                </div>
                <button
                  onClick={() => void sendNotification(c)}
                  disabled={!!loading || s.status !== 'SELECTING'}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold rounded-xl whitespace-nowrap transition-colors shrink-0"
                >
                  {isNotifying ? '⏳' : 'Convocar'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─── Panel layout ──────────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-10 right-4 z-[9000] w-[420px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 5rem)' }}>
      {/* Header */}
      <div className="p-3.5 bg-rose-600 text-white flex items-start gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-black text-sm shrink-0 mt-0.5">
          {(absenceShift.employeeName || 'V')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold opacity-70 uppercase tracking-widest">Protocolo CCT · Cobertura</div>
          <div className="font-black text-base leading-tight truncate mt-0.5">{absenceShift.employeeName || 'Vacante'}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {bandCode && (
              <span className="text-[10px] font-black bg-white/25 rounded-md px-1.5 py-0.5 uppercase tracking-wide">
                {bandCode}{bandLabel !== bandCode ? ` · ${bandLabel}` : ''}
              </span>
            )}
            <span className="text-[10px] opacity-80 truncate">{absenceShift.objectiveName}</span>
            <span className="text-[10px] opacity-60">·</span>
            <span className="text-[10px] opacity-80">{hiStart}–{hiEnd}</span>
          </div>
          {absenceShift.positionName && (
            <div className="text-[10px] opacity-60 mt-0.5 truncate">{absenceShift.positionName}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onMinimize} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 transition-colors" title="Minimizar"><Minimize2 size={13} /></button>
          <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 transition-colors" title="Cerrar"><X size={13} /></button>
        </div>
      </div>

      {/* Steps progress */}
      <div className="px-3 py-2 bg-rose-50 border-b border-rose-100 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0.5 min-w-max">
          {STEPS.map((st, i) => {
            const done = i < s.currentStep || s.status === 'CONFIRMED';
            const active = i === s.currentStep && s.status !== 'CONFIRMED' && s.status !== 'FAILED';
            const sec = active && s.status === 'PENDING' ? s.pending?.sec : null;
            return (
              <React.Fragment key={st.key}>
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black whitespace-nowrap transition-all ${done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-rose-600 text-white shadow-sm' : 'bg-white text-slate-400 border border-slate-200'}`}>
                  {done ? '✓' : st.icon} {st.label}
                  {sec != null && <span className="font-mono ml-0.5 text-[8px]">{fmtCd(sec)}</span>}
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={8} className="text-slate-300 flex-shrink-0" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3.5">
        {s.retentionEmployeeName && (
          <div className="mb-3 p-3 rounded-xl border border-orange-200 bg-orange-50 text-orange-900">
            <div className="text-[9px] font-black uppercase tracking-wide text-orange-700">Retención en puesto</div>
            <div className="text-sm font-bold mt-0.5">{s.retentionEmployeeName}</div>
            <div className="text-[10px] text-orange-800/80 mt-0.5">Último en fichar · sostiene el puesto hasta cobertura</div>
          </div>
        )}
        {s.status === 'CONFIRMED' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle size={48} className="text-emerald-500" />
            <div className="font-black text-emerald-700 text-lg">Cobertura confirmada</div>
          </div>
        )}
        {s.status === 'FAILED' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle size={48} className="text-amber-500" />
            <div className="font-black text-amber-700 text-base">Protocolo CCT agotado</div>
            <p className="text-xs text-slate-500 max-w-[240px]">No se encontró reemplazo disponible en ninguno de los pasos del protocolo.</p>
            <button onClick={() => addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'SIN_COBERTURA', title: 'Sin cobertura', status: 'pending', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName || '', positionName: absenceShift.positionName || '', description: 'Protocolo CCT agotado', createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid)).then(() => { toast.info('Registrado sin cobertura'); onClose(); })} className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-sm transition-colors">
              Registrar sin cobertura
            </button>
          </div>
        )}
        {s.status !== 'CONFIRMED' && s.status !== 'FAILED' && (
          <div>
            {/* Encabezado del paso */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Paso {s.currentStep + 1} de {STEPS.length}</div>
                <div className="text-base font-black text-slate-800 leading-tight mt-0.5">{step.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{step.desc}</div>
                {step.key === 'RETENCION' && (
                  <div className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                    Costo extra · solo plantel del objetivo
                  </div>
                )}
                {step.mandatory && (
                  <div className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
                    <Clock size={9} /> Obligatorio CCT
                  </div>
                )}
              </div>
              {s.status === 'SELECTING' && s.currentStep < STEPS.length - 1 && (
                <button onClick={skipStep} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 font-semibold shrink-0 ml-2 mt-1">
                  <SkipForward size={12} /> Saltear
                </button>
              )}
            </div>

            {s.status === 'PENDING'
              ? renderPending()
              : step.isDual
                ? renderDual()
                : step.key === 'INTERNO'
                  ? internalCount === 0
                    ? (
                      <div className="flex flex-col items-center gap-3 py-8 text-center">
                        <Users size={36} className="text-slate-200" />
                        <div className="text-sm font-bold text-slate-400">Sin RET / REF / ESC en el objetivo</div>
                        {s.currentStep < STEPS.length - 1 && (
                          <button onClick={skipStep} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl text-sm flex items-center gap-1.5 transition-colors">
                            <SkipForward size={13} /> Ext + Adel
                          </button>
                        )}
                      </div>
                    )
                    : (
                      <div>
                        {internalCount > 6 && (
                          <div className="relative mb-2">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                              type="text"
                              placeholder="Buscar guardia..."
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors"
                            />
                          </div>
                        )}
                        {renderInternalBlock('RET — stand-by (prioridad)', 'text-violet-700', internalFiltered.ret)}
                        {renderInternalBlock('REF — refuerzo', 'text-emerald-700', internalFiltered.ref)}
                        {renderInternalBlock('ESC — escuela', 'text-sky-700', internalFiltered.esc)}
                      </div>
                    )
                  : step.key === 'FT' && ftFiltered.length === 0
                    ? (
                      <div className="flex flex-col items-center gap-3 py-8 text-center">
                        <Users size={36} className="text-slate-200" />
                        <div className="text-sm font-bold text-slate-400">Sin francos disponibles</div>
                      </div>
                    )
                    : step.key === 'FT'
                      ? (
                        <div className="flex flex-col gap-2">
                          {ftFiltered.map((c: any) => {
                            const empId = c.employeeId || c.id;
                            const name = c.fullName || c.employeeName || '—';
                            const phone = c.phone || simPhone(empId);
                            const isNotifying = loading === 'notif_' + empId;
                            return (
                              <div key={c.id || empId} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
                                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-black">{initials(name)}</div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-bold truncate">{name}</div>
                                  <div className="text-[11px] font-mono text-slate-500">{phone}</div>
                                </div>
                                <button
                                  onClick={() => void sendNotification({
                                    employeeId: empId,
                                    id: c.id,
                                    fullName: name,
                                    phone,
                                    coverageKind: undefined,
                                    code: 'FT',
                                    shiftRow: c,
                                  } as InternalCoverageCandidate)}
                                  disabled={!!loading || s.status !== 'SELECTING'}
                                  className="px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl shrink-0"
                                >
                                  {isNotifying ? '⏳' : 'Convocar'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )
                      : null
            }
          </div>
        )}
      </div>
    </div>
  );
}
