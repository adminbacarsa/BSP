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
  X, ChevronRight, ChevronLeft, Phone, SkipForward, CheckCircle,
  AlertTriangle, Users, Clock, Minimize2, Search, MapPin,
} from 'lucide-react';
import {
  collection, doc, addDoc, writeBatch, serverTimestamp, Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { toast } from 'sonner';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type StepKey = 'SIN_TURNO' | 'RET_PASIVO' | 'ESC' | 'RETENCION' | 'FT';

export interface PendingSlot { notifId: string; empId: string; sec: number; candShiftId?: string; }

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

// ─── Constantes ───────────────────────────────────────────────────────────────

const STEPS: { key: StepKey; label: string; icon: string; mandatory: boolean; timeoutSec: number; isDual?: boolean; desc: string }[] = [
  { key: 'SIN_TURNO',  label: 'Sin turno',       icon: '1', mandatory: true,  timeoutSec: 60,  desc: 'Empleados disponibles hoy sin turno asignado' },
  { key: 'RET_PASIVO', label: 'Ret. Pasiva',      icon: '2', mandatory: true,  timeoutSec: 180, desc: 'Empleados en stand-by (código RET)' },
  { key: 'ESC',        label: 'ESC / REF',        icon: '3', mandatory: true,  timeoutSec: 60,  desc: 'Empleados en escuela o refuerzo redirigibles' },
  { key: 'RETENCION',  label: 'Ext. 12h',         icon: '4', mandatory: false, timeoutSec: 60,  isDual: true, desc: 'Extender turno actual (EXT) + adelantar próximo (ADV)' },
  { key: 'FT',         label: 'Franco Trabajado', icon: '5', mandatory: false, timeoutSec: 180, desc: 'Empleados con franco disponibles hoy' },
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

const calculateDistance = (lat1: number | null | undefined, lon1: number | null | undefined, lat2: number | null | undefined, lon2: number | null | undefined): number => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) return Infinity;
  const R = 6371; // Radio medio de la Tierra en km
  const dLat = (nLat2 - nLat1) * (Math.PI / 180);
  const dLon = (nLon2 - nLon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(nLat1 * (Math.PI / 180)) * Math.cos(nLat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const formatDistanceKm = (dist: number): string => {
  if (!Number.isFinite(dist)) return 'Sin GPS';
  if (dist < 1) return `${Math.round(dist * 1000)}m`;
  return `${dist.toFixed(1)} km`;
};

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
  const confirmDualRef = useRef<(role: 'ext' | 'adv') => Promise<void>>(async () => {});
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

  const targetDate = toDate(absenceShift.shiftDateObj);

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

  // Empleados que ya tienen turno o descanso asignado en la fecha del turno ausente
  const hasShiftOnTargetDate = new Set<string>(
    (logic.processedData || [])
      .filter((sh: any) => isSameDay(sh.shiftDateObj, targetDate))
      .map((sh: any) => sh.employeeId)
  );

  const busyIds = new Set<string>([
    ...hasShiftOnTargetDate,
    ...crossSessionBusy,
  ]);

  // Empleados con afinidad al objetivo ausente (trabajaron allí hoy o tienen turno allí)
  const objectiveAffinity = new Set<string>(
    (logic.processedData || [])
      .filter((sh: any) => sh.objectiveId === absenceShift.objectiveId)
      .map((sh: any) => sh.employeeId)
  );

  // ── Coordenadas del objetivo ausente ─────────────────────────────────────────
  const objCoords = React.useMemo(() => {
    let lat = absenceShift.lat;
    let lng = absenceShift.lng;
    if ((lat == null || lng == null) && logic.clients) {
      for (const cl of (logic.clients || [])) {
        const obj = (cl.objetivos || []).find((o: any) => o.id === absenceShift.objectiveId);
        if (obj && (obj.lat != null || obj.location?.lat != null)) {
          lat = obj.lat ?? obj.location?.lat;
          lng = obj.lng ?? obj.location?.lng;
          break;
        }
      }
    }
    return {
      lat: Number(lat) || -31.4201,
      lng: Number(lng) || -64.1888,
    };
  }, [absenceShift, logic.clients]);

  const getDistanceToObjective = (emp: any, cand?: any): number => {
    const lat = emp?.lat ?? cand?.lat ?? emp?.location?.lat;
    const lng = emp?.lng ?? cand?.lng ?? emp?.location?.lng;
    if (lat == null || lng == null) return Infinity;
    return calculateDistance(objCoords.lat, objCoords.lng, Number(lat), Number(lng));
  };

  const getCandidateExperience = (emp: any, cand?: any) => {
    const objId = absenceShift.objectiveId;
    if (!objId) return { hasExp: false, label: 'Sin exp.', level: 0 };
    const e = emp || cand || {};
    const empId = e.id || cand?.employeeId || cand?.id;

    // 1. Titular / preferido
    if (e.preferredObjectiveId === objId) {
      return { hasExp: true, label: 'Titular objetivo', level: 3 };
    }

    // 2. Historial en experienciaObjetivos
    const expMap = e.experienciaObjetivos || {};
    const entry = expMap[objId];
    if (entry) {
      const turnosTotal =
        (entry.turnosRegulares ?? 0) +
        (entry.turnosRefuerzo ?? 0) +
        (entry.turnosConvocado ?? 0) +
        (entry.turnosEscuela ?? 0) +
        (entry.count ?? 0);
      if (turnosTotal > 0 || (entry.nivel && entry.nivel !== 'NINGUNO')) {
        return {
          hasExp: true,
          label: turnosTotal > 0 ? `${turnosTotal}T exp.` : 'Con experiencia',
          level: 2,
        };
      }
    }

    // 3. Turnos registrados en este objetivo en processedData
    if (empId && (logic.processedData || []).some((sh: any) => sh.employeeId === empId && sh.objectiveId === objId)) {
      return { hasExp: true, label: 'Turnos previos', level: 1 };
    }

    return { hasExp: false, label: 'Sin exp.', level: 0 };
  };

  const dedupeByEmployee = (list: any[]) => {
    const seen = new Set<string>();
    return list.filter((cand: any) => {
      const id = cand.employeeId || cand.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const byKey = (key: StepKey): any[] => {
    switch (key) {
      case 'SIN_TURNO':
        return (logic.employees || [])
          .filter((e: any) => !busyIds.has(e.id) && e.id !== absenceShift.employeeId)
          .map((e: any) => {
            const dist = getDistanceToObjective(e);
            const exp = getCandidateExperience(e);
            return {
              ...e,
              fullName: e.firstName ? `${e.firstName} ${e.lastName || ''}`.trim() : e.name || e.fullName || '',
              phone: e.phone || e.celular || '',
              distance: dist,
              experience: exp,
              hasAffinity: exp.hasExp,
            };
          });
      case 'RET_PASIVO':
        return (logic.processedData || [])
          .filter((sh: any) =>
            sh.code === 'RET' &&
            isSameDay(sh.shiftDateObj, targetDate) &&
            !sh.isAbsent &&
            !sh.isCompleted &&
            sh.status !== 'COMPLETED' &&
            sh.employeeId !== absenceShift.employeeId &&
            !crossSessionBusy.has(sh.employeeId)
          )
          .map((sh: any) => {
            const emp = (logic.employees || []).find((e: any) => e.id === sh.employeeId);
            const dist = getDistanceToObjective(emp, sh);
            const exp = getCandidateExperience(emp, sh);
            return {
              ...sh,
              fullName: sh.employeeName || emp?.fullName || (emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '') || emp?.name || '',
              phone: sh.phone || emp?.phone || emp?.celular || '',
              distance: dist,
              experience: exp,
              hasAffinity: exp.hasExp,
            };
          });
      case 'ESC':
        return (logic.processedData || [])
          .filter((sh: any) =>
            (sh.code === 'ESC' || sh.code === 'REF') &&
            isSameDay(sh.shiftDateObj, targetDate) &&
            !sh.isAbsent &&
            !sh.isCompleted &&
            sh.status !== 'COMPLETED' &&
            sh.employeeId !== absenceShift.employeeId &&
            !crossSessionBusy.has(sh.employeeId)
          )
          .map((sh: any) => {
            const emp = (logic.employees || []).find((e: any) => e.id === sh.employeeId);
            const dist = getDistanceToObjective(emp, sh);
            const exp = getCandidateExperience(emp, sh);
            return {
              ...sh,
              fullName: sh.employeeName || emp?.fullName || (emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '') || emp?.name || '',
              phone: sh.phone || emp?.phone || emp?.celular || '',
              distance: dist,
              experience: exp,
              hasAffinity: exp.hasExp,
            };
          });
      case 'RETENCION':
        return [];
      case 'FT':
        return (logic.processedData || [])
          .filter((sh: any) =>
            sh.isFranco &&
            isSameDay(sh.shiftDateObj, targetDate) &&
            !sh.isFrancoTrabajado &&
            !sh.isAbsent &&
            sh.employeeId !== absenceShift.employeeId &&
            !crossSessionBusy.has(sh.employeeId)
          )
          .map((sh: any) => {
            const emp = (logic.employees || []).find((e: any) => e.id === sh.employeeId);
            const dist = getDistanceToObjective(emp, sh);
            const exp = getCandidateExperience(emp, sh);
            return {
              ...sh,
              fullName: sh.employeeName || emp?.fullName || (emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '') || emp?.name || '',
              phone: sh.phone || emp?.phone || emp?.celular || '',
              distance: dist,
              experience: exp,
              hasAffinity: exp.hasExp,
            };
          });
    }
  };

  const candidatesExt = dedupeByEmployee((logic.processedData || []).filter((sh: any) =>
    sh.isPresent && !sh.isCompleted &&
    isSameDay(sh.shiftDateObj, targetDate) &&
    sh.objectiveId === absenceShift.objectiveId &&
    sh.positionName === absenceShift.positionName &&
    sh.id !== absenceShift.id
  ));
  // ADV: turno que aún no empezó en el mismo objective/puesto, dentro de las próximas 12h.
  // No se usa isSameDay porque el turno N cruza la medianoche (empieza el día siguiente).
  const advWindowEnd = new Date(targetDate.getTime() + 12 * 3600 * 1000);
  const candidatesAdv = dedupeByEmployee((logic.processedData || [])
    .filter((sh: any) => {
      const shStart = toDate(sh.shiftDateObj);
      return !sh.isPresent && !sh.isCompleted && !sh.isAbsent && !sh.isUnassigned && !sh.isFranco
        && sh.objectiveId === absenceShift.objectiveId
        && sh.positionName === absenceShift.positionName
        && shStart > targetDate && shStart <= advWindowEnd;
    })
    .sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime())
    .slice(0, 1)
  );

  const rawCandidates = dedupeByEmployee(byKey(step.key));

  // Ordenamiento por distancia al objetivo (menor a mayor); desempate por experiencia y luego alfabético
  const sortedCandidates = [...rawCandidates].sort((a: any, b: any) => {
    const distA = Number.isFinite(a.distance) ? a.distance : Infinity;
    const distB = Number.isFinite(b.distance) ? b.distance : Infinity;
    if (distA !== distB) {
      return distA - distB;
    }
    const expA = a.experience?.level ?? (a.hasAffinity ? 1 : 0);
    const expB = b.experience?.level ?? (b.hasAffinity ? 1 : 0);
    if (expB !== expA) {
      return expB - expA;
    }
    return (a.fullName || '').localeCompare(b.fullName || '');
  });

  // Filtro de radio progresivo:
  // "no mostrar aquellos que estan a mas de 15km, si no hubiera en ese radio si mostrar hasta 30 km"
  const within15 = sortedCandidates.filter((c: any) => Number.isFinite(c.distance) && c.distance <= 15);
  const within30 = sortedCandidates.filter((c: any) => Number.isFinite(c.distance) && c.distance <= 30);

  let activeRadiusKm: 15 | 30 | null = 15;
  let radiusFilteredCandidates: any[] = [];

  if (within15.length > 0) {
    activeRadiusKm = 15;
    radiusFilteredCandidates = within15;
  } else if (within30.length > 0) {
    activeRadiusKm = 30;
    radiusFilteredCandidates = within30;
  } else {
    // Si no hay candidatos con GPS en <= 30 km (o ninguno tiene coordenadas cargadas),
    // mostramos los disponibles para no bloquear la cobertura operativa
    activeRadiusKm = null;
    radiusFilteredCandidates = sortedCandidates;
  }

  const allCandidates = radiusFilteredCandidates;
  const candidates = search.trim()
    ? allCandidates.filter((c: any) => {
        const name = (c.fullName || c.employeeName || c.name || '').toLowerCase();
        return name.includes(search.trim().toLowerCase());
      })
    : allCandidates;

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
        else if (role === 'ext') void confirmDualRef.current('ext');
        else void confirmDualRef.current('adv');
      } else if (data.response === 'REJECTED') {
        handled = true;
        if (role === 'single') onUpd({ pending: null, awaitingPhone: false, status: 'SELECTING' });
        else if (role === 'ext') onUpd({ pendingExt: null });
        else onUpd({ pendingAdv: null });
        toast.info('El guardia rechazó la notificación');
      }
    });
  };

  const sendNotification = async (cand: any) => {
    const empId = cand.employeeId || cand.id;
    const candShiftId = (cand.employeeId && cand.id && cand.id !== cand.employeeId)
      ? cand.id
      : (cand.shiftId && cand.shiftId !== empId ? cand.shiftId : undefined);
    setLoading('notif_' + empId);
    try {
      const ref = await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
        employeeId: empId,
        userId: empId,   // legacy compat
        type: 'CONVOCATORIA_COBERTURA',
        title: `Protocolo de cobertura · ${step.label}`,
        body: `Se te solicita cubrir el turno en ${absenceShift.objectiveName} (${hiStart}–${hiEnd}).`,
        objectiveId: absenceShift.objectiveId,
        shiftId: absenceShift.id || null,
        protocolStep: step.key,
        read: false,
        createdAt: serverTimestamp(),
      }, tid));
      onUpd({ status: 'PENDING', pending: { notifId: ref.id, empId, sec: step.timeoutSec, candShiftId }, awaitingPhone: false });
      listenNotif(ref.id, 'single');
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  const confirmCandidate = async () => {
    if (!s.pending) return;
    const empId = s.pending.empId;
    const emp = (logic.employees || []).find((e: any) => e.id === empId);
    const empName = emp?.fullName || (emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : '') || emp?.name || '';

    // Buscar si el candidato tiene un turno real en Firestore para redirigir/transformar
    let candidateShift: any = null;
    const givenShiftId = s.pending.candShiftId;
    if (givenShiftId && givenShiftId !== empId && !String(givenShiftId).startsWith('V124_') && !String(givenShiftId).startsWith('SLA_GAP')) {
      candidateShift = (logic.processedData || []).find((sh: any) => sh.id === givenShiftId);
    }
    if (!candidateShift && step.key !== 'SIN_TURNO') {
      if (step.key === 'RET_PASIVO') {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && sh.code === 'RET' && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      } else if (step.key === 'ESC') {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && (sh.code === 'ESC' || sh.code === 'REF') && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      } else if (step.key === 'FT') {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && sh.isFranco && !sh.isFrancoTrabajado && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      }
      if (!candidateShift) {
        candidateShift = (logic.processedData || []).find((sh: any) => sh.employeeId === empId && sh.id && sh.id !== empId && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP'));
      }
    }

    const candidateShiftId = candidateShift?.id || (givenShiftId && givenShiftId !== empId && !String(givenShiftId).startsWith('V124_') && !String(givenShiftId).startsWith('SLA_GAP') ? givenShiftId : null);

    setLoading('confirm');
    try {
      const batch = writeBatch(db);
      const isReal = absenceShift.isUnassigned && absenceShift.id && !absenceShift.isVirtual && !String(absenceShift.id).startsWith('V124_') && !String(absenceShift.id).startsWith('SLA_GAP');
      const titularNameForCover = absenceShift.causedByEmployeeName
        || (absenceShift.employeeName && !absenceShift.employeeName.startsWith('VACANTE') ? absenceShift.employeeName : '')
        || '';
      const titularIdForCover = absenceShift.causedByEmployeeId
        || (absenceShift.employeeId && absenceShift.employeeId !== 'VACANTE' ? absenceShift.employeeId : null);

      // coveredBy* en el turno ausente alimenta "CUBIERTO POR" en planificación y reportes
      const markCovered = (ct: string) => {
        if (isReal) {
          batch.update(doc(db, 'turnos', absenceShift.id), {
            status: 'COVERED', resolvedBy: 'OPERACIONES', coverageType: ct, coveredAt: serverTimestamp(),
            coveredByEmployeeId: empId, coveredByEmployeeName: empName,
          });
        }
        // Si esta vacante fue generada por una ausencia (causedByShiftId), propagar también al turno ausente original
        if (absenceShift.causedByShiftId && !String(absenceShift.causedByShiftId).startsWith('V124_') && !String(absenceShift.causedByShiftId).startsWith('SLA_GAP')) {
          batch.update(doc(db, 'turnos', absenceShift.causedByShiftId), {
            operacionallyCovered: true,
            resolvedBy: 'OPERACIONES',
            coverageType: ct,
            coveredAt: serverTimestamp(),
            coveredByEmployeeId: empId,
            coveredByEmployeeName: empName,
          });
        }
      };

      if (step.key === 'SIN_TURNO' || !candidateShiftId) {
        const newRef = doc(collection(db, 'turnos'));
        batch.set(newRef, stampEmpresaId({
          employeeId: empId, employeeName: empName,
          clientId: absenceShift.clientId, clientName: absenceShift.clientName,
          objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName,
          positionName: absenceShift.positionName, code: absenceShift.code || 'T',
          startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)),
          endTime: Timestamp.fromDate(absenceEnd),
          status: 'PENDING', origin: 'OPERATIONS_COVERAGE', resolvedBy: 'OPERACIONES',
          coverageType: step.key,
          absenceShiftId: isReal ? absenceShift.id : (absenceShift.causedByShiftId || null),
          coversAbsenceEmployeeName: titularNameForCover || absenceShift.employeeName || '',
          coversEmployeeId: titularIdForCover,
          comments: titularNameForCover ? `Cubriendo a ${titularNameForCover} (${absenceShift.code || 'T'})` : '',
          createdAt: serverTimestamp(),
        }, tid));
        markCovered(step.key);
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'COBERTURA_ASIGNADA', title: 'Cobertura asignada', status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: newRef.id, description: `${empName} asignado a cubrir vacante en ${absenceShift.objectiveName} (${hiStart}–${hiEnd})`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
      } else if (step.key === 'RET_PASIVO' || step.key === 'ESC') {
        batch.update(doc(db, 'turnos', candidateShiftId), {
          coverageRedirectedTo: absenceShift.objectiveId,
          coverageRedirectedAt: serverTimestamp(),
          resolvedBy: 'OPERACIONES',
          coversAbsenceEmployeeName: titularNameForCover || absenceShift.employeeName || '',
          coversEmployeeId: titularIdForCover,
          comments: titularNameForCover ? `Cubriendo a ${titularNameForCover} (${absenceShift.code || 'T'})` : '',
        });
        markCovered(step.key);
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'CONVOCATORIA_COBERTURA', title: `Cobertura ${step.label}`, status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: candidateShiftId, description: `${empName} redirigido a cobertura en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
      } else if (step.key === 'FT') {
        batch.update(doc(db, 'turnos', candidateShiftId), {
          isFranco: false, isFrancoTrabajado: true, code: 'FT', type: 'EXTRA_FRANCO',
          startTime: Timestamp.fromDate(toDate(absenceShift.shiftDateObj)),
          endTime: Timestamp.fromDate(absenceEnd),
          francoTrabajadoAt: serverTimestamp(),
          francoObjectiveId: absenceShift.objectiveId,
          francoObjectiveName: absenceShift.objectiveName,
          coversAbsenceEmployeeName: titularNameForCover || absenceShift.employeeName || '',
          coversEmployeeId: titularIdForCover,
          comments: titularNameForCover ? `Franco Trabajado — cubre a ${titularNameForCover} en ${absenceShift.objectiveName}` : `Franco Trabajado — cubre ${absenceShift.objectiveName}`,
        });
        markCovered('FRANCO');
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', status: 'pending', employeeId: empId, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: candidateShiftId, description: `${empName} trabaja su franco`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
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

  const goToStep = (targetStep: number) => {
    if (targetStep < 0 || targetStep >= STEPS.length) return;
    if (s.status === 'CONFIRMED') return;
    rejectCandidate();
    onUpd({ currentStep: targetStep, status: 'SELECTING', pending: null, pendingExt: null, pendingAdv: null, awaitingPhone: false });
  };

  const prevStep = () => {
    if (s.currentStep > 0) {
      goToStep(s.currentStep - 1);
    }
  };

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
        addDoc(collection(db, 'user_notifications'), stampEmpresaId({ employeeId: extEmpId, userId: extEmpId, type: 'RETENCION', title: 'Extensión de jornada', body: `Tu turno en ${absenceShift.objectiveName} se extiende hasta ${hiEnd}.`, objectiveId: absenceShift.objectiveId, shiftId: extShift?.id || null, protocolStep: 'RETENCION_EXT', read: false, createdAt: serverTimestamp() }, tid)),
        addDoc(collection(db, 'user_notifications'), stampEmpresaId({ employeeId: advEmpId, userId: advEmpId, type: 'ADELANTO', title: 'Adelanto de turno', body: `Tu turno en ${absenceShift.objectiveName} fue adelantado.`, objectiveId: absenceShift.objectiveId, shiftId: advShift?.id || null, protocolStep: 'RETENCION_ADV', read: false, createdAt: serverTimestamp() }, tid)),
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
      const isRealVacant = absenceShift.id && !absenceShift.isVirtual && !String(absenceShift.id).startsWith('V124_') && !String(absenceShift.id).startsWith('SLA_GAP');
      if (role === 'ext') {
        const sh = candidatesExt.find((x: any) => x.employeeId === slot.empId);
        const isRealExt = sh && sh.id && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP') && sh.id !== slot.empId;
        // endTime real = fin de la ausencia: la app móvil y el cronograma leen endTime
        if (isRealExt) batch.update(doc(db, 'turnos', sh.id), {
          isRetention: true,
          isExtended: true,
          retentionEndTime: Timestamp.fromDate(absenceEnd),
          endTime: Timestamp.fromDate(absenceEnd),
        });
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'RETENCION', title: 'Retención EXT', status: 'pending', employeeId: slot.empId, employeeName: sh?.employeeName || '', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: isRealExt ? sh.id : null, description: `${sh?.employeeName} retenido — 1ª mitad`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
        const newConfirmedExt = slot.empId;
        if (s.confirmedAdv) {
          // Ambos confirmados: escribir coveredBy en el turno ausente con formato "EXT HH:MM-HH:MM + ADV HH:MM-HH:MM"
          const advSh = candidatesAdv.find((x: any) => x.employeeId === s.confirmedAdv);
          const extName = (sh?.employeeName || '').split(' ')[0];
          const advName = (advSh?.employeeName || '').split(' ')[0];
          const extLabel = `${extName} ext ${hiStart}–${hiEnd}`;
          const advLabel = `${advName} adel ${fmtTime(advSh?.shiftDateObj)}–${hiEnd}`;
          const covLabel = `${extLabel} + ${advLabel}`;
          if (isRealVacant) batch.update(doc(db, 'turnos', absenceShift.id), { coveredByEmployeeName: covLabel, resolvedBy: 'OPERACIONES', coverageType: 'RETENCION', coveredAt: serverTimestamp() });
          if (absenceShift.causedByShiftId && !String(absenceShift.causedByShiftId).startsWith('V124_') && !String(absenceShift.causedByShiftId).startsWith('SLA_GAP')) {
            batch.update(doc(db, 'turnos', absenceShift.causedByShiftId), {
              operacionallyCovered: true,
              resolvedBy: 'OPERACIONES',
              coverageType: 'RETENCION',
              coveredAt: serverTimestamp(),
              coveredByEmployeeName: covLabel,
            });
          }
          await batch.commit();
          toast.success('Cobertura completa');
          onUpd({ status: 'CONFIRMED', confirmedExt: newConfirmedExt, pendingExt: null });
          setTimeout(onClose, 2000);
        } else onUpd({ confirmedExt: newConfirmedExt, pendingExt: null });
      } else {
        const sh = candidatesAdv.find((x: any) => x.employeeId === slot.empId);
        const isRealAdv = sh && sh.id && !String(sh.id).startsWith('V124_') && !String(sh.id).startsWith('SLA_GAP') && sh.id !== slot.empId;
        // Hora real de adelanto = inicio del turno ausente (no la hora de confirmación del operador)
        const vacancyStart = Timestamp.fromDate(toDate(absenceShift.shiftDateObj));
        if (isRealAdv) batch.update(doc(db, 'turnos', sh.id), {
          adjustedStartTime: vacancyStart,
          startTime: vacancyStart,
          isEarlyStart: true,
        });
        await batch.commit();
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'ADELANTO_TURNO', title: 'Adelanto ADV', status: 'pending', employeeId: slot.empId, employeeName: sh?.employeeName || '', objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: isRealAdv ? sh.id : null, description: `${sh?.employeeName} adelantado — 2ª mitad`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tid));
        const newConfirmedAdv = slot.empId;
        if (s.confirmedExt) {
          const extSh = candidatesExt.find((x: any) => x.employeeId === s.confirmedExt);
          const extName = (extSh?.employeeName || '').split(' ')[0];
          const advName = (sh?.employeeName || '').split(' ')[0];
          const extLabel = `${extName} ext ${hiStart}–${hiEnd}`;
          const advLabel = `${advName} adel ${fmtTime(sh?.shiftDateObj)}–${hiEnd}`;
          const covLabel = `${extLabel} + ${advLabel}`;
          if (isRealVacant) batch.update(doc(db, 'turnos', absenceShift.id), { coveredByEmployeeName: covLabel, resolvedBy: 'OPERACIONES', coverageType: 'RETENCION', coveredAt: serverTimestamp() });
          if (absenceShift.causedByShiftId && !String(absenceShift.causedByShiftId).startsWith('V124_') && !String(absenceShift.causedByShiftId).startsWith('SLA_GAP')) {
            batch.update(doc(db, 'turnos', absenceShift.causedByShiftId), {
              operacionallyCovered: true,
              resolvedBy: 'OPERACIONES',
              coverageType: 'RETENCION',
              coveredAt: serverTimestamp(),
              coveredByEmployeeName: covLabel,
            });
          }
          await batch.commit();
          toast.success('Cobertura completa');
          onUpd({ status: 'CONFIRMED', confirmedAdv: newConfirmedAdv, pendingAdv: null });
          setTimeout(onClose, 2000);
        } else onUpd({ confirmedAdv: newConfirmedAdv, pendingAdv: null });
      }
    } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
    finally { setLoading(null); }
  };

  // Mantener ref siempre actualizado (evita closures stale en onSnapshot)
  confirmDualRef.current = confirmDual;

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
        <div className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-emerald-400 bg-emerald-50">
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-black flex-shrink-0">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-emerald-800 truncate">{name}</div>
            <div className="text-[10px] text-emerald-600">Confirmado</div>
          </div>
        </div>
      );

      if (isPendingThis) return (
        <div className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-amber-400 bg-amber-50">
          <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 text-[9px] font-black font-mono flex-shrink-0">{fmtCd(pendingSlot!.sec)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-amber-900 truncate">{name}</div>
            <div className="text-xs font-black font-mono text-amber-800">📱 {phone}</div>
          </div>
        </div>
      );

      return (
        <div
          onClick={() => { if (slotBusy) return; const key = cand.id || empId; if (role === 'ext') onUpd({ selectedExtId: s.selectedExtId === key ? null : key }); else onUpd({ selectedAdvId: s.selectedAdvId === key ? null : key }); }}
          style={{ opacity: slotBusy ? 0.3 : 1 }}
          className={`flex items-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{isSelected ? '✓' : initials(name)}</div>
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>{name}</div>
            <div className="text-xs font-mono text-slate-600">📱 {phone}</div>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs text-slate-500 leading-snug">{isPending ? '⏳ Esperando respuesta de cada guardia' : 'Seleccioná uno de cada columna y notificá a ambos.'}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5 bg-violet-50 border border-violet-200 rounded-xl p-2">
            <div className="text-[9px] font-black text-violet-700 uppercase tracking-wider border-b border-violet-200 pb-1.5 mb-0.5">⟵ 1ª mitad · EXT</div>
            {s.confirmedExt
              ? <DualCard cand={candidatesExt.find((sh: any) => sh.employeeId === s.confirmedExt) || { id: s.confirmedExt, employeeId: s.confirmedExt }} role="ext" />
              : s.pendingExt
                ? <DualCard cand={candidatesExt.find((sh: any) => sh.employeeId === s.pendingExt!.empId) || { id: s.pendingExt.empId, employeeId: s.pendingExt.empId }} role="ext" />
                : candidatesExt.length === 0
                  ? <p className="text-[10px] text-slate-400 italic text-center py-2">Sin candidatos</p>
                  : candidatesExt.map((c: any) => <DualCard key={c.id} cand={c} role="ext" />)}
          </div>
          <div className="flex flex-col gap-1.5 bg-sky-50 border border-sky-200 rounded-xl p-2">
            <div className="text-[9px] font-black text-sky-700 uppercase tracking-wider border-b border-sky-200 pb-1.5 mb-0.5">2ª mitad · ADV ⟶</div>
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
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
            <div className="text-[9px] font-bold text-amber-800 uppercase tracking-wide mb-2">Resultado</div>
            <div className="flex flex-col gap-2">
              {s.pendingExt && !s.confirmedExt && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black text-violet-700 w-7 shrink-0">EXT</span>
                  <button onClick={() => confirmDual('ext')} disabled={!!loading} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg">✓ Acepta</button>
                  <button onClick={() => rejectDual('ext')} disabled={!!loading} className="flex-1 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg">✗ Rechaza</button>
                </div>
              )}
              {s.pendingAdv && !s.confirmedAdv && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black text-sky-700 w-7 shrink-0">ADV</span>
                  <button onClick={() => confirmDual('adv')} disabled={!!loading} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg">✓ Acepta</button>
                  <button onClick={() => rejectDual('adv')} disabled={!!loading} className="flex-1 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg">✗ Rechaza</button>
                </div>
              )}
            </div>
          </div>
        )}
        {!isPending && (
          <button onClick={sendDual} disabled={!canNotify || !!loading}
            className={`w-full py-3 font-black rounded-2xl text-sm transition-colors shadow-sm ${canNotify ? 'bg-violet-700 hover:bg-violet-800 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            {loading === 'dual' ? '...' : canNotify ? '⚡ Notificar a ambos simultáneamente' : s.selectedExtId ? 'Falta ADV →' : s.selectedAdvId ? '← Falta EXT' : 'Seleccioná uno de cada columna'}
          </button>
        )}
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
                <button
                  type="button"
                  onClick={() => goToStep(i)}
                  disabled={s.status === 'CONFIRMED'}
                  title={`Ir al paso ${i + 1}: ${st.label}`}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black whitespace-nowrap transition-all cursor-pointer hover:opacity-90 active:scale-95 disabled:cursor-default disabled:opacity-100 ${
                    done
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : active
                        ? 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-300'
                        : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {done ? '✓' : st.icon} {st.label}
                  {sec != null && <span className="font-mono ml-0.5 text-[8px]">{fmtCd(sec)}</span>}
                </button>
                {i < STEPS.length - 1 && <ChevronRight size={8} className="text-slate-300 flex-shrink-0" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3.5">
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
                {step.mandatory && (
                  <div className="inline-flex items-center gap-1 mt-1 text-[9px] font-black text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
                    <Clock size={9} /> Obligatorio CCT
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-2 mt-1">
                {s.status === 'SELECTING' && s.currentStep > 0 && (
                  <button onClick={prevStep} className="flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-slate-800 font-bold transition-colors px-2 py-1 rounded-lg hover:bg-slate-100">
                    <ChevronLeft size={13} /> Anterior
                  </button>
                )}
                {s.status === 'SELECTING' && s.currentStep < STEPS.length - 1 && (
                  <button onClick={skipStep} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 font-semibold transition-colors px-2 py-1 rounded-lg hover:bg-slate-100">
                    <SkipForward size={12} /> Saltear
                  </button>
                )}
              </div>
            </div>

            {s.status === 'PENDING'
              ? renderPending()
              : step.isDual
                ? renderDual()
                : candidates.length === 0 && allCandidates.length === 0
                  ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <Users size={36} className="text-slate-200" />
                      <div className="text-sm font-bold text-slate-400">Sin candidatos disponibles</div>
                      <p className="text-xs text-slate-400 max-w-[200px]">No hay empleados que cumplan los criterios de este paso.</p>
                      <div className="flex items-center gap-2 justify-center mt-2">
                        {s.currentStep > 0 && (
                          <button onClick={prevStep} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm flex items-center gap-1 transition-colors">
                            <ChevronLeft size={14} /> Anterior
                          </button>
                        )}
                        {s.currentStep < STEPS.length - 1 && (
                          <button onClick={skipStep} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl text-sm flex items-center gap-1.5 transition-colors">
                            <SkipForward size={13} /> Siguiente paso
                          </button>
                        )}
                      </div>
                    </div>
                  )
                  : (
                    <div className="flex flex-col gap-2">
                      {/* Búsqueda — cuando hay más de 5 candidatos */}
                      {allCandidates.length > 5 && (
                        <div className="relative">
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <input
                            type="text"
                            placeholder={`Buscar entre ${allCandidates.length} candidatos...`}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-400 focus:bg-white transition-colors"
                          />
                        </div>
                      )}

                      {/* Banner de radio de distancia y estado de búsqueda */}
                      <div className="rounded-xl border p-2 text-[10px] font-semibold">
                        {activeRadiusKm === 15 ? (
                          <div className="flex items-center justify-between text-indigo-700 bg-indigo-50/70 -m-2 p-2 rounded-xl">
                            <span className="flex items-center gap-1">
                              <MapPin size={11} className="text-indigo-600" /> Radio: <strong>≤ 15 km</strong> del objetivo
                            </span>
                            <span className="font-bold text-indigo-900">{candidates.length}{search ? ` de ${allCandidates.length}` : ''} disponibles</span>
                          </div>
                        ) : activeRadiusKm === 30 ? (
                          <div className="flex items-center justify-between text-amber-800 bg-amber-50 -m-2 p-2 rounded-xl">
                            <span className="flex items-center gap-1">
                              <MapPin size={11} className="text-amber-600" /> Sin candidatos a 15 km · Ampliado a <strong>≤ 30 km</strong>
                            </span>
                            <span className="font-bold text-amber-900">{candidates.length}{search ? ` de ${allCandidates.length}` : ''} disponibles</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-slate-600 bg-slate-100 -m-2 p-2 rounded-xl">
                            <span className="flex items-center gap-1">
                              <MapPin size={11} className="text-slate-400" /> Sin candidatos dentro de 30 km · Mostrando disponibles
                            </span>
                            <span className="font-bold text-slate-800">{candidates.length}{search ? ` de ${allCandidates.length}` : ''} disponibles</span>
                          </div>
                        )}
                      </div>

                      {/* Lista */}
                      {candidates.length === 0 && search && (
                        <div className="text-center py-4 text-xs text-slate-400">Sin resultados para "{search}"</div>
                      )}
                      {candidates.map((c: any) => {
                        const empId = c.employeeId || c.id;
                        const name = c.fullName || c.employeeName || c.name || '—';
                        const phone = c.phone || c.celular || simPhone(empId);
                        const isNotifying = loading === 'notif_' + empId;
                        const hasExp = !!c.experience?.hasExp;
                        const expLabel = c.experience?.label || (c.hasAffinity ? 'Con experiencia' : 'Sin exp.');
                        return (
                          <div key={c.id || empId} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors">
                            <div className="relative shrink-0">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black ${
                                hasExp ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' : 'bg-slate-100 text-slate-600'
                              }`}>{initials(name)}</div>
                              {hasExp && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-600 border-2 border-white flex items-center justify-center text-[9px] text-white" title={expLabel}>🎯</div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-bold text-slate-800 truncate leading-tight">{name}</span>
                                {hasExp ? (
                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                    ✓ {expLabel}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 shrink-0">
                                    Sin exp.
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap mt-1">
                                <span className="text-xs font-bold font-mono text-slate-600">📱 {phone}</span>
                                {Number.isFinite(c.distance) ? (
                                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0">
                                    <MapPin size={10} className="text-indigo-500" />
                                    {formatDistanceKm(c.distance)}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0" title="Empleado sin coordenadas GPS registradas">
                                    <MapPin size={10} className="text-slate-300" />
                                    Sin GPS
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => sendNotification(c)}
                              disabled={!!loading || s.status !== 'SELECTING'}
                              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold rounded-xl whitespace-nowrap transition-colors shrink-0"
                            >
                              {isNotifying ? <span className="flex items-center gap-1">⏳</span> : 'Notificar'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )
            }
          </div>
        )}
      </div>
    </div>
  );
}
