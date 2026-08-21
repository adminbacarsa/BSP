import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, doc, getDoc, addDoc } from 'firebase/firestore';
import {
  Shield, CheckCircle, XCircle, Users, AlertCircle,
  RefreshCw, Plus, X, MessageSquare, User, Search,
} from 'lucide-react';
import {
  solicitudRefuerzoService,
  SolicitudRefuerzo,
  SolicitudEstado,
} from '@/services/solicitudRefuerzoService';
import { absenceService, Absence } from '@/services/absenceService';
import { Timestamp } from 'firebase/firestore';
import { buildRefuerzoNovedadPayload, calcRefuerzoPactadaHours } from '@/lib/refuerzo/refuerzoDisplay';
import {
  fmtTs, urgencyLevel, hoursSincePending, pendingHoursLabel, URGENCY_STYLES,
  filterAbsencesByObjectives, filterSolicitudesByObjectives,
  type SupervisionMainTab,
} from '@/lib/supervision/supervisionUtils';
import { useSupervisorScope } from '@/hooks/useSupervisorScope';
import SupervisionBottomNav from '@/components/admin/supervision/SupervisionBottomNav';
import SupervisionTablero from '@/components/admin/supervision/SupervisionTablero';
import SupervisionNovedades from '@/components/admin/supervision/SupervisionNovedades';
import SupervisionMas from '@/components/admin/supervision/SupervisionMas';
import SupervisionClienteObjetivoPicker from '@/components/admin/supervision/SupervisionClienteObjetivoPicker';

// ─── helpers ───────────────────────────────────────────────────────────────

function estadoBadge(estado: SolicitudEstado) {
  const map: Record<SolicitudEstado, { label: string; cls: string }> = {
    PENDIENTE:  { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
    APROBADA:   { label: 'Aprobada',   cls: 'bg-teal-100 text-teal-700 border border-teal-200' },
    RECHAZADA:  { label: 'Rechazada',  cls: 'bg-rose-100 text-rose-700 border border-rose-200' },
    ASIGNADA:   { label: 'Asignada',   cls: 'bg-indigo-100 text-indigo-700 border border-indigo-200' },
    COMPLETADA: { label: 'Completada', cls: 'bg-slate-100 text-slate-600 border border-slate-200' },
    CANCELADA:  { label: 'Cancelada',  cls: 'bg-slate-100 text-slate-400 border border-slate-200' },
  };
  const { label, cls } = map[estado] || map.PENDIENTE;
  return <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${cls}`}>{label}</span>;
}

function tipoBadge(tipo: 'REFUERZO_PUESTO' | 'AGREGADO_TURNO') {
  return tipo === 'REFUERZO_PUESTO'
    ? <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200">Refuerzo</span>
    : <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-violet-100 text-violet-700 border border-violet-200">Agregado</span>;
}

// ─── Rechazar modal ─────────────────────────────────────────────────────────

function RechazarModal({ solicitud, onClose, onConfirm }: {
  solicitud: SolicitudRefuerzo;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black text-slate-900 dark:text-white uppercase text-sm">Rechazar solicitud</h3>
          <button onClick={onClose} className="p-1.5 bg-slate-100 dark:bg-slate-700 rounded-full"><X size={16}/></button>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Solicitud de <strong>{solicitud.clientName}</strong> — {solicitud.objectiveName} · {solicitud.fecha}
        </p>
        <textarea
          autoFocus
          placeholder="Motivo del rechazo (requerido)..."
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          className="w-full p-3 border-2 border-slate-200 dark:border-slate-600 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white resize-none outline-none focus:border-rose-400"
          rows={3}
        />
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100 transition-colors">Cancelar</button>
          <button
            disabled={!motivo.trim()}
            onClick={() => onConfirm(motivo.trim())}
            className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl font-black text-xs hover:bg-rose-700 transition-colors disabled:opacity-40"
          >Confirmar rechazo</button>
        </div>
      </div>
    </div>
  );
}

// ─── Aprobar modal ──────────────────────────────────────────────────────────

function AprobarModal({ solicitud, onClose, onConfirm }: {
  solicitud: SolicitudRefuerzo;
  onClose: () => void;
  onConfirm: (nota: string) => void;
}) {
  const [nota, setNota] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black text-slate-900 dark:text-white uppercase text-sm">Aprobar solicitud</h3>
          <button onClick={onClose} className="p-1.5 bg-slate-100 dark:bg-slate-700 rounded-full"><X size={16}/></button>
        </div>
        <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl p-3 mb-3 space-y-1 text-xs">
          <p><strong>Cliente:</strong> {solicitud.clientName}</p>
          <p><strong>Objetivo:</strong> {solicitud.objectiveName}</p>
          <p><strong>Fecha:</strong> {solicitud.fecha} · {solicitud.startTime}–{solicitud.endTime}</p>
          <p><strong>Tipo:</strong> {solicitud.tipo === 'REFUERZO_PUESTO' ? `Refuerzo +${solicitud.cantidadPax || 1} pax` : `Agregado al turno de ${solicitud.parentEmpleadoName || '—'}`}</p>
          <p><strong>Motivo cliente:</strong> {solicitud.motivo}</p>
        </div>
        <textarea
          placeholder="Nota interna (opcional)..."
          value={nota}
          onChange={e => setNota(e.target.value)}
          className="w-full p-3 border-2 border-slate-200 dark:border-slate-600 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white resize-none outline-none focus:border-teal-400"
          rows={2}
        />
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100 transition-colors">Cancelar</button>
          <button
            onClick={() => onConfirm(nota.trim())}
            className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl font-black text-xs hover:bg-teal-700 transition-colors"
          >Aprobar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Ausencia card ──────────────────────────────────────────────────────────

function AusenciaCard({ ausencia, showActions, onAprobar, onRechazar, onGenerarRefuerzo }: {
  ausencia: Absence;
  showActions?: boolean;
  onAprobar: () => void;
  onRechazar: (motivo: string) => void;
  onGenerarRefuerzo?: () => void;
}) {
  const [showRechazo, setShowRechazo] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState('');

  const tipoColor: Record<string, string> = {
    Vacaciones:      'bg-emerald-100 text-emerald-700 border-emerald-200',
    Enfermedad:      'bg-blue-100 text-blue-700 border-blue-200',
    Licencia:        'bg-violet-100 text-violet-700 border-violet-200',
    ART:             'bg-amber-100 text-amber-700 border-amber-200',
    NO_PRESENTACION: 'bg-rose-100 text-rose-700 border-rose-200',
  };
  const colorCls = tipoColor[ausencia.type] || 'bg-slate-100 text-slate-600 border-slate-200';
  const label = ausencia.type === 'NO_PRESENTACION' ? 'No se presentó' : ausencia.type;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${colorCls}`}>{label}</span>
            {(() => {
              const s = ausencia.status;
              const sc = s === 'Pendiente' ? 'bg-amber-100 text-amber-700 border-amber-200'
                : s === 'Autorizada' || s === 'Justificada' ? 'bg-teal-100 text-teal-700 border-teal-200'
                : s === 'Rechazada' || s === 'Injustificada' ? 'bg-rose-100 text-rose-700 border-rose-200'
                : 'bg-slate-100 text-slate-500 border-slate-200';
              return <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${sc}`}>{s}</span>;
            })()}
          </div>
          <p className="font-black text-sm text-slate-800 dark:text-white">{ausencia.employeeName}</p>
          <p className="text-xs font-bold text-slate-500 mt-0.5">📅 {ausencia.startDate} → {ausencia.endDate}</p>
          {ausencia.reason && <p className="mt-1 text-[11px] text-slate-500 italic">"{ausencia.reason}"</p>}
        </div>
        {onGenerarRefuerzo && ausencia.type === 'NO_PRESENTACION' && (
          <button
            type="button"
            onClick={onGenerarRefuerzo}
            className="mt-3 w-full py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-1 border border-orange-200"
          >
            <Plus size={13} /> Generar refuerzo
          </button>
        )}
        {showActions && !showRechazo && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setShowRechazo(true)}
              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl font-black text-xs transition-colors flex items-center gap-1">
              <XCircle size={13}/> Rechazar
            </button>
            <button onClick={onAprobar}
              className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-xl font-black text-xs transition-colors flex items-center gap-1">
              <CheckCircle size={13}/> Autorizar
            </button>
          </div>
        )}
      </div>
      {showActions && showRechazo && (
        <div className="mt-3 space-y-2">
          <textarea autoFocus placeholder="Motivo del rechazo (requerido)..." value={motivoRechazo}
            onChange={e => setMotivoRechazo(e.target.value)}
            className="w-full p-2.5 border-2 border-slate-200 rounded-xl text-xs resize-none outline-none focus:border-rose-400" rows={2}/>
          <div className="flex gap-2">
            <button onClick={() => setShowRechazo(false)}
              className="flex-1 py-2 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100 transition-colors">Cancelar</button>
            <button disabled={!motivoRechazo.trim()}
              onClick={() => { onRechazar(motivoRechazo.trim()); setShowRechazo(false); }}
              className="flex-1 py-2 bg-rose-600 text-white rounded-xl font-black text-xs hover:bg-rose-700 disabled:opacity-40 transition-colors">
              Confirmar rechazo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ParentShiftInfo ────────────────────────────────────────────────────────

function ParentShiftInfo({ parentShiftId }: { parentShiftId?: string }) {
  const [info, setInfo] = useState<{ code: string; start: string; end: string } | null>(null);
  useEffect(() => {
    if (!parentShiftId) return;
    getDoc(doc(db, 'turnos', parentShiftId)).then(snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      const fmt = (ts: any): string => {
        if (ts?.seconds) return new Date(ts.seconds * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        if (typeof ts === 'string' && ts.includes('T')) return ts.split('T')[1]?.slice(0, 5) || ts;
        return ts || '';
      };
      setInfo({ code: d.code || '?', start: fmt(d.startTime), end: fmt(d.endTime) });
    }).catch(() => {});
  }, [parentShiftId]);
  if (!info) return null;
  return (
    <span className="text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-lg">
      {info.code} {info.start}–{info.end}
    </span>
  );
}

// ─── tipos locales ──────────────────────────────────────────────────────────

interface SlaPosition {
  id: string;
  name: string;
  shifts: { code: string; name: string; startTime: string; endTime: string }[];
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function SupervisionPage() {
  const { user, isSuperAdmin } = useAuth();
  const { empresaId } = useEmpresa();
  const { scopedObjectives, objectiveIds, assignedIds, canViewAllObjectives } = useSupervisorScope(user?.uid, empresaId, isSuperAdmin);
  const shiftObjectiveCache = useRef(new Map<string, string>());

  const [solicitudes, setSolicitudes] = useState<SolicitudRefuerzo[]>([]);
  const [ausencias, setAusencias] = useState<Absence[]>([]);
  const [vacaciones, setVacaciones] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = usePersistedState<SupervisionMainTab>('cosp:sup:mainTab', 'BANDEJA');
  const [tab, setTab] = usePersistedState<'PENDIENTE' | 'TODAS' | 'AUSENCIAS' | 'VACACIONES'>('cosp:sup:tab', 'PENDIENTE');
  const [rechazarTarget, setRechazarTarget] = useState<SolicitudRefuerzo | null>(null);
  const [aprobarTarget, setAprobarTarget] = useState<SolicitudRefuerzo | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroObjetivo, setFiltroObjetivo] = useState('');

  // Formulario manual supervisor
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [mTipo, setMTipo]   = useState<'REFUERZO_PUESTO' | 'AGREGADO_TURNO'>('REFUERZO_PUESTO');
  const [mClienteId, setMClienteId] = useState('');
  const [mObjetivoId, setMObjetivoId] = useState('');
  const [mFecha, setMFecha] = useState('');
  const [mStart, setMStart] = useState('');
  const [mEnd, setMEnd]     = useState('');
  const [mMotivo, setMMotivo]     = useState('');
  const [mSolicitante, setMSolicitante] = useState('');
  const [mCanal, setMCanal] = useState<'TELEFONO' | 'WHATSAPP' | 'EMAIL' | 'PRESENCIAL'>('TELEFONO');
  const [mPax, setMPax]     = useState(1);
  const [mPosicionNombre, setMPosicionNombre] = useState('');
  const [mGuardiaAAmpliar, setMGuardiaAAmpliar] = useState('');
  const [mGuardiaEmpleadoId, setMGuardiaEmpleadoId]   = useState('');
  const [mGuardiaShiftId, setMGuardiaShiftId]         = useState('');
  const [slaPositions, setSlaPositions] = useState<SlaPosition[]>([]);
  const [mSelPosId, setMSelPosId]       = useState('');
  const [mSelShiftCode, setMSelShiftCode] = useState('');
  const [guardias, setGuardias] = useState<{ shiftId: string; nombre: string; empleadoId: string; horario: string; code: string; puesto: string }[]>();
  const todayStr = new Date().toISOString().split('T')[0];
  const [ausenciasFecha, setAusenciasFecha] = useState(todayStr);
  const currentMonthStr = todayStr.slice(0, 7); // YYYY-MM
  const [licenciasMes, setLicenciasMes] = useState(currentMonthStr);

  // Cargar puestos del SLA activo cuando cambia el objetivo (para RFZ)
  useEffect(() => {
    setSlaPositions([]); setMSelPosId(''); setMSelShiftCode('');
    if (!mObjetivoId) return;
    getDocs(query(collection(db, 'servicios_sla'), where('objectiveId', '==', mObjetivoId), where('status', '==', 'active')))
      .then(snap => {
        let best: any[] = [];
        snap.docs.forEach(d => { const ps = d.data().positions || []; if (ps.length > best.length) best = ps; });
        const posMap = new Map<string, SlaPosition>();
        best.forEach((p: any) => {
          const key = p.id || p.name;
          if (!key || posMap.has(key)) return;
          const shifts = (p.allowedShiftTypes || []).map((s: any) => ({
            code: s.code, name: s.name || s.code,
            startTime: s.startTime || '', endTime: s.endTime || '',
          })).filter((s: any) => s.startTime);
          if (shifts.length) posMap.set(key, { id: p.id || p.name, name: p.name, shifts });
        });
        setSlaPositions(Array.from(posMap.values()));
      });
  }, [mObjetivoId]);

  // Cargar guardias con turno en el objetivo/fecha seleccionados (para TURA)
  useEffect(() => {
    setGuardias(undefined); setMGuardiaAAmpliar(''); setMGuardiaEmpleadoId(''); setMGuardiaShiftId('');
    if (mTipo !== 'AGREGADO_TURNO' || !mObjetivoId || !mFecha) return;
    setGuardias([]);
    const fmtHora = (val: any): string => {
      if (!val) return '';
      try {
        let d: Date | null = null;
        if (typeof val === 'string') d = new Date(val);
        else if (val.seconds) d = new Date(val.seconds * 1000);
        else if (val.toDate) d = val.toDate();
        if (!d || isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
      } catch { return ''; }
    };
    getDocs(query(collection(db, 'turnos'), where('objectiveId', '==', mObjetivoId)))
      .then(snap => {
        const seen = new Set<string>();
        const del_dia = snap.docs.map(d => ({ id: d.id, ...d.data() } as any)).filter((t: any) => {
          let tFecha: string = typeof t.fecha === 'string' ? t.fecha : '';
          if (!tFecha && t.startTime?.seconds) tFecha = new Date(t.startTime.seconds * 1000).toISOString().slice(0, 10);
          return tFecha === mFecha && !t.isAbsent && !t.isFranco
            && t.employeeId && t.employeeId !== 'VACANTE'
            && !seen.has(t.employeeId) && !!seen.add(t.employeeId);
        });
        if (!del_dia.length) { setGuardias([]); return; }
        Promise.all(del_dia.map(async (t: any) => {
          let nombre = t.employeeName || t.empleadoName || '';
          if (!nombre) {
            try {
              const e = await getDoc(doc(db, 'empleados', t.employeeId));
              if (e.exists()) {
                const d = e.data();
                nombre = [d.apellido || d.lastName, d.nombre || d.firstName].filter(Boolean).join(', ') || d.name || t.employeeId;
              }
            } catch { /* keep */ }
          }
          const hi = fmtHora(t.startTime);
          const hf = fmtHora(t.endTime);
          const horario = hi && hf ? `${hi}–${hf}` : (hi || '');
          return {
            shiftId: t.id,
            nombre: nombre || t.employeeId,
            empleadoId: t.employeeId,
            horario,
            code: String(t.code || t.type || '').toUpperCase(),
            puesto: t.positionName || '',
          };
        })).then(lista => setGuardias(lista));
      });
  }, [mTipo, mObjetivoId, mFecha]);

  // Limpiar estado al cambiar empresa para evitar flash de datos anteriores
  useEffect(() => {
    setSolicitudes([]);
    setAusencias([]);
    setVacaciones([]);
  }, [empresaId]);

  // Suscripciones en tiempo real (filtradas por objetivos asignados)
  useEffect(() => {
    if (!empresaId) return;
    setLoading(true);
    const unsubSol = solicitudRefuerzoService.subscribeByEmpresa(empresaId, items => {
      setSolicitudes(filterSolicitudesByObjectives(items, objectiveIds, canViewAllObjectives));
      setLoading(false);
    });
    const unsubAus = absenceService.subscribePendientes(empresaId, items => {
      void filterAbsencesByObjectives(
        items as any[],
        objectiveIds,
        canViewAllObjectives,
        shiftObjectiveCache.current,
      ).then(setAusencias);
    });
    const unsubVac = absenceService.subscribeAllByEmpresa(empresaId, items => {
      const base = items.filter(a => a.type !== 'NO_PRESENTACION' && a.status !== 'Rechazada' && a.status !== 'Injustificada');
      void filterAbsencesByObjectives(
        base as any[],
        objectiveIds,
        canViewAllObjectives,
        shiftObjectiveCache.current,
      ).then(setVacaciones);
    });
    return () => { unsubSol(); unsubAus(); unsubVac(); };
  }, [empresaId, objectiveIds, canViewAllObjectives]);

  const pendientes = solicitudes.filter(s => s.estado === 'PENDIENTE');
  const visiblesBase = tab === 'PENDIENTE' ? pendientes : solicitudes;
  const visibles = useMemo(() => {
    let list = visiblesBase;
    if (filtroCliente) {
      const objectiveIdsForClient = new Set(
        scopedObjectives.filter(obj => obj.clientId === filtroCliente).map(obj => obj.id),
      );
      list = list.filter(item => objectiveIdsForClient.has(item.objectiveId));
    }
    if (filtroObjetivo) list = list.filter(s => s.objectiveId === filtroObjetivo);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      list = list.filter(s =>
        s.objectiveName?.toLowerCase().includes(q) ||
        s.clientName?.toLowerCase().includes(q) ||
        s.motivo?.toLowerCase().includes(q) ||
        s.solicitadoPorNombre?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [visiblesBase, filtroCliente, filtroObjetivo, busqueda, scopedObjectives]);

  const abrirRefuerzoDesdeAusencia = useCallback((a: Absence, fechaDia: string) => {
    setMainTab('BANDEJA');
    setTab('PENDIENTE');
    setMTipo('REFUERZO_PUESTO');
    setMFecha(fechaDia || todayStr);
    setMMotivo(`Cobertura por ausencia de ${a.employeeName}${a.reason ? ` — ${a.reason}` : ''}`);
    setShowManualForm(true);
  }, [todayStr]);

  const handleAprobarAusencia = useCallback(async (a: Absence) => {
    if (!a.id || !user) return;
    try {
      await absenceService.update(a.id, { status: 'Autorizada' });
      toast.success(`Ausencia autorizada — ${a.employeeName}`);
    } catch (e: any) {
      toast.error(`Error: ${e?.message}`);
    }
  }, [user]);

  const handleRechazarAusencia = useCallback(async (a: Absence, motivo: string) => {
    if (!a.id || !user) return;
    try {
      await absenceService.update(a.id, { status: 'Rechazada', rejectionReason: motivo });
      toast.success('Ausencia rechazada');
    } catch (e: any) {
      toast.error(`Error: ${e?.message}`);
    }
  }, [user]);

  // Crea los turnos reales en Firestore al aprobar una solicitud
  async function crearTurnosParaSolicitud(
    sol: SolicitudRefuerzo,
    opts?: { draft?: boolean },
  ): Promise<string[]> {
    const nextDayDate = (dateStr: string) => {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    };
    const isOvernight = sol.endTime < sol.startTime;
    const fechaFin = isOvernight ? nextDayDate(sol.fecha) : sol.fecha;
    const startISO = `${sol.fecha}T${sol.startTime}:00`;
    const endISO   = `${fechaFin}T${sol.endTime}:00`;

    const isAgregado = sol.tipo === 'AGREGADO_TURNO';
    const horasPactadas = calcRefuerzoPactadaHours(sol.startTime, sol.endTime);

    // El turno DEBE llevar empresaId para aparecer en Planificación (la grilla filtra por empresa).
    // Si la solicitud (portal) no lo trae, lo resolvemos del cliente.
    let resolvedEmpresaId = String(sol.empresaId || '').trim();
    if (!resolvedEmpresaId && sol.clientId) {
      try {
        const cDoc = await getDoc(doc(db, 'clients', sol.clientId));
        if (cDoc.exists()) resolvedEmpresaId = String(cDoc.data().empresaId || '').trim();
      } catch { /* keep empty */ }
    }

    const base = {
      empresaId:           resolvedEmpresaId,
      objectiveId:         sol.objectiveId,
      clientId:            sol.clientId,
      clientName:          sol.clientName,
      objectiveName:       sol.objectiveName,
      fecha:               sol.fecha,
      startTime:           startISO,
      endTime:             endISO,
      hours:               horasPactadas,
      origin:              'CLIENT_REQUEST',
      solicitudRefuerzoId: sol.id,
      code:                isAgregado ? 'TURA' : 'RFZ',
      isPresent:           false,
      isAbsent:            false,
      isCompleted:         false,
      // TURA = extensión de un guardia ya publicado → se auto-publica (notifica al instante).
      // RFZ = vacante a asignar en Planificación → queda en borrador hasta republicar.
      draft:               isAgregado ? false : (opts?.draft ?? false),
      autorizadoPorUid:    user?.uid ?? null,
      autorizadoPorNombre: user?.displayName || user?.email || null,
      autorizadoAt:        Timestamp.now(),
    };

    const ids: string[] = [];
    if (isAgregado) {
      let parentPositionName: string | null = null;
      if (sol.parentShiftId) {
        try {
          const ps = await getDoc(doc(db, 'turnos', sol.parentShiftId));
          if (ps.exists()) parentPositionName = ps.data().positionName || null;
        } catch { /* keep null */ }
      }
      const ref = await addDoc(collection(db, 'turnos'), {
        ...base,
        employeeId:    sol.parentEmpleadoId  ?? null,
        employeeName:  sol.parentEmpleadoName ?? null,
        parentShiftId: sol.parentShiftId      ?? null,
        positionName:  parentPositionName,
      });
      ids.push(ref.id);
    } else {
      // REFUERZO_PUESTO: una vacante (RFZ) por pax solicitado
      const n = sol.cantidadPax ?? 1;
      for (let i = 0; i < n; i++) {
        const ref = await addDoc(collection(db, 'turnos'), {
          ...base,
          employeeId:   'VACANTE',
          positionId:   sol.positionId   ?? null,
          positionName: sol.positionName ?? null,
        });
        ids.push(ref.id);
      }
    }
    return ids;
  }

  const handleAprobar = useCallback(async (nota: string) => {
    if (!aprobarTarget?.id || !user) return;
    const sol = aprobarTarget;
    if (sol.estado !== 'PENDIENTE') {
      toast.error('Esta solicitud ya fue procesada');
      setAprobarTarget(null);
      return;
    }
    const vaAPlanificacion = sol.origen === 'PORTAL_CLIENTE';

    try {
      if (vaAPlanificacion) {
        toast.loading('Aprobando — enviando a Planificación…', { id: 'aprobar' });
        const turnoIds = await crearTurnosParaSolicitud(sol, { draft: true });
        await solicitudRefuerzoService.update(sol.id, {
          estado:              'APROBADA',
          autorizadoPorUid:    user.uid,
          autorizadoPorNombre: user.displayName || user.email || '',
          autorizadoAt:        Timestamp.now(),
          actionTarget:        'PLANIFICACION',
          turnoIds,
          ...(nota ? { notaInterna: nota } as any : {}),
        });
        await addDoc(collection(db, 'novedades'), {
          ...buildRefuerzoNovedadPayload(sol, {
            reportedBy: 'SUPERVISION',
            actionTarget: 'PLANIFICACION',
            turnoIds,
          }),
          autorizadoPorNombre: user.displayName || user.email || '',
          createdAt: Timestamp.now(),
        });
        toast.success(
          turnoIds.length === 1
            ? 'Aprobada — asigná guardia al RFZ en Planificación (fila VACANTE RFZ)'
            : `Aprobada — ${turnoIds.length} vacantes RFZ en Planificación`,
          { id: 'aprobar' },
        );
      } else {
        toast.loading('Aprobando y generando turno…', { id: 'aprobar' });
        const turnoIds = await crearTurnosParaSolicitud(sol);
        const estadoFinal = sol.tipo === 'AGREGADO_TURNO' ? 'ASIGNADA' : 'APROBADA';
        await solicitudRefuerzoService.update(sol.id, {
          estado:              estadoFinal,
          autorizadoPorUid:    user.uid,
          autorizadoPorNombre: user.displayName || user.email || '',
          autorizadoAt:        Timestamp.now(),
          turnoIds,
          actionTarget:        'OPERACIONES',
          ...(nota ? { notaInterna: nota } as any : {}),
        });
        await addDoc(collection(db, 'novedades'), {
          ...buildRefuerzoNovedadPayload(sol, {
            reportedBy: 'SUPERVISION',
            actionTarget: 'OPERACIONES',
            turnoIds,
          }),
          autorizadoPorNombre: user.displayName || user.email || '',
          createdAt: Timestamp.now(),
        });
        toast.success(
          turnoIds.length === 1
            ? `Aprobada — turno creado (${turnoIds[0].slice(0, 6)}…)`
            : `Aprobada — ${turnoIds.length} turnos creados`,
          { id: 'aprobar' },
        );
      }
    } catch (e: any) {
      toast.error(`Error: ${e?.message || 'No se pudo aprobar'}`, { id: 'aprobar' });
    }
    setAprobarTarget(null);
  }, [aprobarTarget, user]);

  const resetManualForm = () => {
    setMTipo('REFUERZO_PUESTO'); setMClienteId(''); setMObjetivoId('');
    setMFecha(''); setMStart(''); setMEnd(''); setMMotivo('');
    setMSolicitante(''); setMCanal('TELEFONO'); setMPax(1);
    setMPosicionNombre(''); setMGuardiaAAmpliar('');
    setMGuardiaEmpleadoId(''); setMGuardiaShiftId('');
    setSlaPositions([]); setMSelPosId(''); setMSelShiftCode('');
    setGuardias(undefined);
    setShowManualForm(false);
  };

  const handleCrearManual = async () => {
    if (!user || !empresaId || !mClienteId || !mObjetivoId || !mFecha || !mStart || !mEnd || !mMotivo.trim()) return;
    setManualSaving(true);
    try {
      const selectedObjective = scopedObjectives.find(obj => obj.id === mObjetivoId);
      const isOvernight = mEnd < mStart;
      const nextDay = (d: string) => { const dt = new Date(d + 'T00:00:00'); dt.setDate(dt.getDate() + 1); return dt.toISOString().split('T')[0]; };
      const fechaFin = isOvernight ? nextDay(mFecha) : mFecha;
      const startISO = `${mFecha}T${mStart}:00`;
      const endISO   = `${fechaFin}T${mEnd}:00`;

      const isAgregado = mTipo === 'AGREGADO_TURNO';
      const horasPactadas = calcRefuerzoPactadaHours(mStart, mEnd);
      const base = {
        empresaId,
        objectiveId:   mObjetivoId,
        objectiveName: selectedObjective?.name || mObjetivoId,
        clientId:      mClienteId,
        clientName:    selectedObjective?.clientName || mClienteId,
        fecha:         mFecha,
        startTime:     startISO,
        endTime:       endISO,
        hours:         horasPactadas,
        origin:        'CLIENT_REQUEST',
        code:          isAgregado ? 'TURA' : 'RFZ',
        isPresent: false, isAbsent: false, isCompleted: false, draft: false,
        autorizadoPorUid:    user!.uid,
        autorizadoPorNombre: user!.displayName || user!.email || null,
        autorizadoAt:        Timestamp.now(),
      };
      // Crear los turnos vacantes directamente (urgente, ya pasó el corte de planificación)
      const n = isAgregado ? 1 : mPax;
      const turnoIds: string[] = [];
      for (let i = 0; i < n; i++) {
        const turnoExtra: Record<string, unknown> = { ...base, employeeId: 'VACANTE' };
        if (!isAgregado && mPosicionNombre.trim()) turnoExtra.positionName = mPosicionNombre.trim();
        if (isAgregado && mGuardiaAAmpliar.trim())  turnoExtra.parentEmpleadoName = mGuardiaAAmpliar.trim();
        if (isAgregado && mGuardiaEmpleadoId)       turnoExtra.parentEmpleadoId   = mGuardiaEmpleadoId;
        if (isAgregado && mGuardiaShiftId)          turnoExtra.parentShiftId      = mGuardiaShiftId;
        const r = await addDoc(collection(db, 'turnos'), turnoExtra);
        turnoIds.push(r.id);
      }
      // Guardar la solicitud como ya aprobada
      const solicitudId = await solicitudRefuerzoService.create({
        empresaId,
        clientId:            mClienteId,
        clientName:          selectedObjective?.clientName || mClienteId,
        objectiveId:         mObjetivoId,
        objectiveName:       selectedObjective?.name || mObjetivoId,
        tipo:                mTipo,
        fecha:               mFecha,
        startTime:           mStart,
        endTime:             mEnd,
        motivo:              mMotivo.trim(),
        origen:              'SUPERVISOR_MANUAL' as const,
        estado:              'APROBADA' as const,
        solicitadoPorUid:    user!.uid,
        solicitadoPorNombre: mSolicitante.trim() || 'Sin especificar',
        canalSolicitud:      mCanal,
        solicitadoAt:        Timestamp.now(),
        autorizadoPorUid:    user!.uid,
        autorizadoPorNombre: user!.displayName || user!.email || '',
        autorizadoAt:        Timestamp.now(),
        turnoIds,
        ...(!isAgregado ? { cantidadPax: mPax, positionName: mPosicionNombre.trim() || undefined } : {}),
        ...(isAgregado  ? {
          parentEmpleadoName: mGuardiaAAmpliar.trim() || undefined,
          parentEmpleadoId:   mGuardiaEmpleadoId || undefined,
          parentShiftId:      mGuardiaShiftId    || undefined,
        } : {}),
      });
      // Novedad para OPERACIONES (vacante urgente, no alcanzó el plazo de planificación)
      const manualSol: SolicitudRefuerzo = {
        id:                  solicitudId,
        empresaId,
        clientId:            mClienteId,
        clientName:          selectedObjective?.clientName || mClienteId,
        objectiveId:         mObjetivoId,
        objectiveName:       selectedObjective?.name || mObjetivoId,
        tipo:                mTipo,
        fecha:               mFecha,
        startTime:           mStart,
        endTime:             mEnd,
        motivo:              mMotivo.trim(),
        origen:              'SUPERVISOR_MANUAL',
        estado:              'APROBADA',
        solicitadoPorUid:    user!.uid,
        solicitadoPorNombre: mSolicitante.trim() || 'Sin especificar',
        solicitadoAt:        Timestamp.now(),
        cantidadPax:         isAgregado ? 1 : mPax,
        positionName:        !isAgregado && mPosicionNombre.trim() ? mPosicionNombre.trim() : undefined,
        parentEmpleadoName:  isAgregado && mGuardiaAAmpliar.trim() ? mGuardiaAAmpliar.trim() : undefined,
        parentEmpleadoId:    isAgregado ? mGuardiaEmpleadoId || undefined : undefined,
        parentShiftId:       isAgregado ? mGuardiaShiftId || undefined : undefined,
      };
      await addDoc(collection(db, 'novedades'), {
        ...buildRefuerzoNovedadPayload(manualSol, {
          reportedBy: 'SUPERVISION',
          actionTarget: 'OPERACIONES',
          turnoIds,
        }),
        canalSolicitud: mCanal,
        createdBy:      user.displayName || user.email || '',
        createdAt:      Timestamp.now(),
        origin:         'SUPERVISOR_MANUAL',
      });
      toast.success(`${n} turno${n > 1 ? 's' : ''} ${base.code} creado${n > 1 ? 's' : ''} como vacante operativa`);
      resetManualForm();
    } catch (e: any) {
      toast.error(`Error: ${e?.message || 'No se pudo crear'}`);
    } finally { setManualSaving(false); }
  };

  const handleRechazar = useCallback(async (motivo: string) => {
    if (!rechazarTarget?.id || !user) return;
    const p = solicitudRefuerzoService.update(rechazarTarget.id, {
      estado: 'RECHAZADA',
      autorizadoPorUid: user.uid,
      autorizadoPorNombre: user.displayName || user.email || '',
      autorizadoAt: Timestamp.now(),
      motivoRechazo: motivo,
    });
    toast.promise(p, {
      loading: 'Rechazando…',
      success: 'Solicitud rechazada',
      error: 'Error al rechazar',
    });
    await p;
    setRechazarTarget(null);
  }, [rechazarTarget, user]);

  const userName = user?.displayName || user?.email || 'Supervisor';
  const bandejaBadge = pendientes.length + ausencias.filter(a => a.type !== 'NO_PRESENTACION' && a.status === 'Pendiente').length;

  return (
    <DashboardLayout>
      <Head><title>Supervisión — COSP</title></Head>

      <div className="flex flex-col min-h-[calc(100dvh-3.5rem)] lg:min-h-0 -mx-3 sm:-mx-5 lg:mx-0">
        <div className="sticky top-0 z-40 bg-[var(--app-bg)]/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-700/80 px-4 py-3 lg:rounded-2xl lg:mx-0 lg:mb-4 lg:border lg:shadow-sm">
          <div className="flex items-center justify-between gap-3 max-w-5xl mx-auto">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 bg-teal-50 dark:bg-teal-900/30 rounded-xl text-teal-600 shrink-0">
                <Shield size={20}/>
              </div>
              <div className="min-w-0">
                <h1 className="font-black text-lg text-slate-900 dark:text-white uppercase tracking-tight truncate">Supervisión</h1>
                <p className="text-[10px] text-slate-500 font-medium truncate">
                  {isSuperAdmin
                    ? 'Vista completa — todos los objetivos'
                    : assignedIds.length
                      ? `${assignedIds.length} objetivo${assignedIds.length !== 1 ? 's' : ''} asignado${assignedIds.length !== 1 ? 's' : ''}`
                      : 'Sin objetivos asignados'}
                  {pendientes.length > 0 && ` · ${pendientes.length} pend.`}
                </p>
              </div>
            </div>
            {mainTab === 'BANDEJA' && (
              <button
                type="button"
                onClick={() => setShowManualForm(true)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-[10px] uppercase shadow-sm active:scale-95 transition-transform"
              >
                <Plus size={14}/> Urgente
              </button>
            )}
          </div>
          <div className="hidden lg:flex gap-2 max-w-5xl mx-auto mt-4">
            {([
              ['BANDEJA', 'Bandeja'],
              ['TABLERO', 'Tablero'],
              ['NOVEDADES', 'Novedades'],
              ['MAS', 'Más'],
            ] as [SupervisionMainTab, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMainTab(id)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-colors ${
                  mainTab === id
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 px-4 pt-3 pb-28 lg:pb-6 max-w-5xl mx-auto w-full overflow-x-hidden">
          {mainTab === 'TABLERO' && (
            <SupervisionTablero objectiveIds={objectiveIds} canViewAllObjectives={canViewAllObjectives} />
          )}

          {mainTab === 'NOVEDADES' && user?.uid && (
            <SupervisionNovedades
              objectiveIds={objectiveIds}
              objectives={scopedObjectives}
              userUid={user.uid}
              userName={userName}
            />
          )}

          {mainTab === 'MAS' && empresaId && user?.uid && (
            <SupervisionMas
              empresaId={empresaId}
              objectiveIds={objectiveIds}
              objectives={scopedObjectives}
              userUid={user.uid}
              userName={userName}
              isSuperAdmin={isSuperAdmin}
              canViewAllObjectives={canViewAllObjectives}
            />
          )}

          {mainTab === 'BANDEJA' && (
      <div className="space-y-4">
        {(() => {
          const noPresentes = ausencias.filter(a => a.type === 'NO_PRESENTACION');
          const licencias   = ausencias.filter(a => a.type !== 'NO_PRESENTACION');
          return (
            <>
              <div className="flex gap-2 flex-wrap">
                {(['PENDIENTE', 'TODAS'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-colors ${
                      tab === t ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-white dark:bg-slate-800 border text-slate-500 hover:bg-slate-50'
                    }`}>
                    {t === 'PENDIENTE' ? `Pendientes (${pendientes.length})` : `Todas (${solicitudes.length})`}
                  </button>
                ))}
                <button onClick={() => setTab('AUSENCIAS')}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-colors flex items-center gap-1.5 ${
                    tab === 'AUSENCIAS' ? 'bg-rose-600 text-white' : 'bg-white dark:bg-slate-800 border text-slate-500 hover:bg-slate-50'
                  }`}>
                  <AlertCircle size={12}/> Ausencias ({noPresentes.length})
                </button>
                <button onClick={() => setTab('VACACIONES')}
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-colors flex items-center gap-1.5 ${
                    tab === 'VACACIONES' ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-slate-800 border text-slate-500 hover:bg-slate-50'
                  }`}>
                  <Users size={12}/> Vac / Lic ({vacaciones.filter(a => a.status === 'Pendiente').length > 0 ? `${vacaciones.filter(a => a.status === 'Pendiente').length} pend.` : vacaciones.length})
                </button>
              </div>

              {(tab === 'PENDIENTE' || tab === 'TODAS') && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={busqueda}
                      onChange={e => setBusqueda(e.target.value)}
                      placeholder="Buscar cliente, objetivo, motivo…"
                      className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 rounded-2xl text-xs font-medium"
                    />
                  </div>
                  <div className="sm:w-[320px]">
                    <SupervisionClienteObjetivoPicker
                      objectives={scopedObjectives}
                      clientId={filtroCliente}
                      objectiveId={filtroObjetivo}
                      onClientChange={setFiltroCliente}
                      onObjectiveChange={setFiltroObjetivo}
                      allowAll
                      compact
                    />
                  </div>
                </div>
              )}

              {/* ── Tab Refuerzos ── */}
              {(tab === 'PENDIENTE' || tab === 'TODAS') && (
                loading ? (
                  <div className="flex justify-center py-12"><RefreshCw className="animate-spin text-slate-400" size={28}/></div>
                ) : visibles.length === 0 ? (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center">
                    <CheckCircle size={32} className="mx-auto text-slate-300 mb-3"/>
                    <p className="text-slate-500 font-medium text-sm">
                      {tab === 'PENDIENTE' ? 'No hay solicitudes pendientes' : 'No hay solicitudes registradas'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibles.map(s => {
                      const urg = urgencyLevel(s.fecha);
                      const urgStyle = URGENCY_STYLES[urg];
                      const pendH = s.estado === 'PENDIENTE' ? pendingHoursLabel(hoursSincePending(s.solicitadoAt)) : null;
                      return (
                      <div key={s.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {tipoBadge(s.tipo)}
                              {estadoBadge(s.estado)}
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${urgStyle.cls}`}>{urgStyle.label}</span>
                              {pendH && <span className="text-[9px] font-bold text-amber-600">{pendH}</span>}
                              <span className="text-[9px] text-slate-400 font-mono">{fmtTs(s.solicitadoAt)}</span>
                            </div>
                            <p className="font-black text-sm text-slate-800 dark:text-white truncate">{s.objectiveName}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{s.clientName}</p>
                            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                📅 {s.fecha} · {s.startTime}–{s.endTime}
                              </span>
                              {s.tipo === 'REFUERZO_PUESTO' && (
                                <>
                                  {s.cantidadPax && <span className="text-xs text-orange-600 font-bold">+{s.cantidadPax} pax</span>}
                                  {(s as any).positionName && (
                                    <span className="text-xs text-slate-500 font-medium flex items-center gap-1">📌 {(s as any).positionName}</span>
                                  )}
                                </>
                              )}
                              {s.tipo === 'AGREGADO_TURNO' && s.parentEmpleadoName && (
                                <span className="text-xs text-violet-600 font-bold flex items-center gap-1">
                                  <User size={10}/>{s.parentEmpleadoName}
                                </span>
                              )}
                              {s.tipo === 'AGREGADO_TURNO' && (s as any).parentShiftId && (
                                <ParentShiftInfo parentShiftId={(s as any).parentShiftId}/>
                              )}
                            </div>
                            {s.solicitadoPorNombre && (
                              <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
                                <User size={10} className="shrink-0"/>
                                Solicitado por <span className="font-bold text-slate-600 dark:text-slate-300 ml-1">{s.solicitadoPorNombre}</span>
                              </p>
                            )}
                            {s.motivo && (
                              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1">
                                <MessageSquare size={10} className="mt-0.5 shrink-0"/>
                                <span className="italic">"{s.motivo}"</span>
                              </p>
                            )}
                            {s.motivoRechazo && (
                              <p className="mt-1 text-[11px] text-rose-500 flex items-start gap-1">
                                <XCircle size={10} className="mt-0.5 shrink-0"/>
                                <span>{s.motivoRechazo}</span>
                              </p>
                            )}
                          </div>
                          {s.estado === 'PENDIENTE' && (
                            <div className="flex gap-2 shrink-0 w-full sm:w-auto">
                              <button onClick={() => setRechazarTarget(s)}
                                className="flex-1 sm:flex-none px-3 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl font-black text-xs transition-colors flex items-center justify-center gap-1">
                                <XCircle size={13}/> Rechazar
                              </button>
                              <button onClick={() => setAprobarTarget(s)}
                                className="flex-1 sm:flex-none px-3 py-2.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-xl font-black text-xs transition-colors flex items-center justify-center gap-1">
                                <CheckCircle size={13}/> Aprobar
                              </button>
                            </div>
                          )}
                          {s.estado === 'APROBADA' && (
                            <span className="text-[10px] text-teal-600 font-bold shrink-0">✓ {s.autorizadoPorNombre}</span>
                          )}
                        </div>
                      </div>
                    );})}
                  </div>
                )
              )}

              {/* ── Tab Ausencias (NO_PRESENTACION) — solo informativo ── */}
              {tab === 'AUSENCIAS' && (() => {
                const ausFiltered = noPresentes.filter(a =>
                  !ausenciasFecha || (a.startDate <= ausenciasFecha && a.endDate >= ausenciasFecha)
                );
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-[10px] font-black uppercase text-slate-500">Día</label>
                      <input type="date" value={ausenciasFecha} onChange={e => setAusenciasFecha(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-rose-400"/>
                      {ausenciasFecha !== todayStr && (
                        <button onClick={() => setAusenciasFecha(todayStr)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
                          <X size={11}/> Hoy
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400 font-medium ml-auto">{ausFiltered.length} resultado{ausFiltered.length !== 1 ? 's' : ''}</span>
                    </div>
                    {ausFiltered.length === 0 ? (
                      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center">
                        <CheckCircle size={32} className="mx-auto text-slate-300 mb-3"/>
                        <p className="text-slate-500 font-medium text-sm">Sin ausencias para {ausenciasFecha || 'este período'}</p>
                      </div>
                    ) : (
                      ausFiltered.map(a => (
                        <AusenciaCard key={a.id} ausencia={a} showActions={false}
                          onAprobar={() => {}} onRechazar={() => {}}
                          onGenerarRefuerzo={() => abrirRefuerzoDesdeAusencia(a, ausenciasFecha)}/>
                      ))
                    )}
                  </div>
                );
              })()}

              {/* ── Tab Vacaciones / Licencias — historial + autorización pendientes ── */}
              {tab === 'VACACIONES' && (() => {
                const mesStart = licenciasMes ? `${licenciasMes}-01` : '';
                const mesEnd   = licenciasMes
                  ? new Date(Number(licenciasMes.slice(0,4)), Number(licenciasMes.slice(5,7)), 0)
                      .toISOString().split('T')[0]
                  : '';
                const vacFiltered = licenciasMes
                  ? vacaciones.filter(a => a.startDate <= mesEnd && a.endDate >= mesStart)
                  : vacaciones;
                const pendientes = vacFiltered.filter(a => a.status === 'Pendiente');
                const autorizadas = vacFiltered.filter(a => a.status !== 'Pendiente');
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-[10px] font-black uppercase text-slate-500">Mes</label>
                      <input type="month" value={licenciasMes} onChange={e => setLicenciasMes(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-emerald-400"/>
                      {licenciasMes !== currentMonthStr && (
                        <button onClick={() => setLicenciasMes(currentMonthStr)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
                          <X size={11}/> Mes actual
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400 font-medium ml-auto">{vacFiltered.length} resultado{vacFiltered.length !== 1 ? 's' : ''}</span>
                    </div>
                    {vacFiltered.length === 0 ? (
                      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-10 text-center">
                        <CheckCircle size={32} className="mx-auto text-slate-300 mb-3"/>
                        <p className="text-slate-500 font-medium text-sm">Sin vacaciones/licencias para {licenciasMes || 'este período'}</p>
                      </div>
                    ) : (
                      <>
                        {pendientes.length > 0 && (
                          <p className="text-[10px] font-black uppercase text-amber-600 px-1">Pendientes de autorización ({pendientes.length})</p>
                        )}
                        {pendientes.map(a => (
                          <AusenciaCard key={a.id} ausencia={a} showActions={true}
                            onAprobar={() => handleAprobarAusencia(a)}
                            onRechazar={motivo => handleRechazarAusencia(a, motivo)}/>
                        ))}
                        {autorizadas.length > 0 && (
                          <p className="text-[10px] font-black uppercase text-teal-600 px-1 mt-2">Autorizadas / En curso ({autorizadas.length})</p>
                        )}
                        {autorizadas.map(a => (
                          <AusenciaCard key={a.id} ausencia={a} showActions={false}
                            onAprobar={() => {}} onRechazar={() => {}}/>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          );
        })()}
      </div>
          )}

        </div>

        <SupervisionBottomNav
          active={mainTab}
          onChange={setMainTab}
          badges={{ BANDEJA: bandejaBadge }}
        />
      </div>

      {rechazarTarget && (
        <RechazarModal
          solicitud={rechazarTarget}
          onClose={() => setRechazarTarget(null)}
          onConfirm={handleRechazar}
        />
      )}
      {aprobarTarget && (
        <AprobarModal
          solicitud={aprobarTarget}
          onClose={() => setAprobarTarget(null)}
          onConfirm={handleAprobar}
        />
      )}

      {/* ── Modal carga manual supervisor ── */}
      {showManualForm && (
        <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-slate-900/60 backdrop-blur-md" onClick={() => !manualSaving && resetManualForm()}>
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl w-full max-w-lg mx-auto lg:rounded-2xl lg:my-auto lg:max-h-[90vh] p-6 shadow-2xl border border-slate-100 dark:border-slate-700 space-y-4 max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-white uppercase text-sm flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-lg text-[10px]">Manual</span>
                Cargar RFZ / TURA
              </h3>
              <button onClick={resetManualForm} className="p-1.5 bg-slate-100 dark:bg-slate-700 rounded-full"><X size={16}/></button>
            </div>
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-bold flex items-center gap-2">
              <AlertCircle size={12}/> Carga directa como vacante operativa — Operaciones recibe la notificación
            </p>

            {/* Tipo */}
            <div className="flex gap-2">
              {(['REFUERZO_PUESTO', 'AGREGADO_TURNO'] as const).map(t => (
                <button key={t} type="button" onClick={() => setMTipo(t)}
                  className={`flex-1 py-2 rounded-xl text-xs font-black uppercase border transition-colors ${mTipo === t ? 'bg-red-600 text-white border-red-600' : 'border-slate-200 text-slate-500 hover:border-red-300'}`}>
                  {t === 'REFUERZO_PUESTO' ? 'RFZ Refuerzo' : 'TURA Agregado'}
                </button>
              ))}
            </div>

            <SupervisionClienteObjetivoPicker
              objectives={scopedObjectives}
              clientId={mClienteId}
              objectiveId={mObjetivoId}
              onClientChange={setMClienteId}
              onObjectiveChange={setMObjetivoId}
            />

            {/* RFZ — Puesto del SLA + turnos disponibles */}
            {mTipo === 'REFUERZO_PUESTO' && mObjetivoId && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Puesto</label>
                    {slaPositions.length > 0 ? (
                      <select value={mSelPosId} onChange={e => {
                        const id = e.target.value;
                        setMSelPosId(id); setMSelShiftCode(''); setMStart(''); setMEnd('');
                        setMPosicionNombre(slaPositions.find(p => p.id === id)?.name || '');
                      }} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400">
                        <option value="">— Seleccioná un puesto —</option>
                        {slaPositions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <input type="text" placeholder="Ej: Portería norte, Acceso vehicular…" value={mPosicionNombre} onChange={e => setMPosicionNombre(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400"/>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Cantidad</label>
                    <input type="number" min={1} max={20} value={mPax} onChange={e => setMPax(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400"/>
                  </div>
                </div>
                {mSelPosId && (() => {
                  const shifts = slaPositions.find(p => p.id === mSelPosId)?.shifts || [];
                  if (!shifts.length) return null;
                  return (
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Turno del puesto</label>
                      <div className="flex gap-2 flex-wrap">
                        {shifts.map(s => (
                          <button key={s.code} type="button"
                            onClick={() => { setMSelShiftCode(s.code); setMStart(s.startTime); setMEnd(s.endTime); }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-colors ${mSelShiftCode === s.code ? 'bg-red-600 text-white border-red-600' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-red-300'}`}>
                            <span>{s.code}</span> <span className="font-normal opacity-75">{s.startTime}–{s.endTime}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* Fecha y horarios */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Fecha</label>
                <input type="date" value={mFecha} onChange={e => setMFecha(e.target.value)}
                  className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400"/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Inicio</label>
                <input type="time" value={mStart} onChange={e => setMStart(e.target.value)}
                  className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400"/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Fin</label>
                <input type="time" value={mEnd} onChange={e => setMEnd(e.target.value)}
                  className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400"/>
              </div>
            </div>

            {/* TURA — Guardia a ampliar (carga de turnos del día) */}
            {mTipo === 'AGREGADO_TURNO' && mObjetivoId && (
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                  Guardia a ampliar
                  {!mFecha && <span className="text-slate-300 font-normal ml-1">(seleccioná fecha primero)</span>}
                </label>
                {guardias === undefined && mFecha && (
                  <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                    <RefreshCw size={12} className="animate-spin"/> Buscando guardias…
                  </div>
                )}
                {Array.isArray(guardias) && guardias.length === 0 && mFecha && (
                  <p className="text-xs text-slate-400 py-1">Sin guardias con turno ese día — ingresá el nombre manualmente</p>
                )}
                {Array.isArray(guardias) && guardias.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {guardias.map(g => {
                      const activo = mGuardiaShiftId === g.shiftId;
                      return (
                        <button key={g.shiftId} type="button"
                          onClick={() => { setMGuardiaShiftId(g.shiftId); setMGuardiaEmpleadoId(g.empleadoId); setMGuardiaAAmpliar(g.nombre); }}
                          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors flex items-start gap-2 text-left ${activo ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-violet-300'}`}>
                          <User size={12} className="mt-0.5 shrink-0"/>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{g.nombre}</span>
                            <span className={`block mt-0.5 text-[10px] font-bold ${activo ? 'text-violet-100' : 'text-slate-500'}`}>
                              {g.horario
                                ? <>{g.code && <span className={`px-1 py-0.5 rounded mr-1 ${activo ? 'bg-violet-500' : 'bg-slate-200 text-slate-600'}`}>{g.code}</span>}{g.horario}{g.puesto ? ` · ${g.puesto}` : ''}</>
                                : <span className="italic opacity-70">Sin horario</span>}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {(!Array.isArray(guardias) || guardias.length === 0) && (
                  <input type="text" placeholder="Nombre del guardia cuyo turno se extiende" value={mGuardiaAAmpliar}
                    onChange={e => setMGuardiaAAmpliar(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400 mt-1"/>
                )}
                {mGuardiaAAmpliar && (
                  <p className="text-[10px] text-violet-600 font-bold mt-1">✓ {mGuardiaAAmpliar}</p>
                )}
              </div>
            )}

            {/* Solicitante y canal */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Solicitado por</label>
                <input type="text" placeholder="Nombre del contacto cliente" value={mSolicitante} onChange={e => setMSolicitante(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400"/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Canal</label>
                <select value={mCanal} onChange={e => setMCanal(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-red-400">
                  <option value="TELEFONO">Teléfono</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                  <option value="PRESENCIAL">Presencial</option>
                </select>
              </div>
            </div>

            {/* Motivo */}
            <div>
              <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Motivo</label>
              <textarea rows={2} placeholder="Descripción del pedido..." value={mMotivo} onChange={e => setMMotivo(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold resize-none focus:outline-none focus:border-red-400"/>
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={resetManualForm} disabled={manualSaving}
                className="flex-1 py-2.5 rounded-xl font-bold text-xs text-slate-500 hover:bg-slate-100 transition-colors">
                Cancelar
              </button>
              <button type="button"
                disabled={manualSaving || !mClienteId || !mObjetivoId || !mFecha || !mStart || !mEnd || !mMotivo.trim()}
                onClick={handleCrearManual}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 transition-colors">
                {manualSaving ? <RefreshCw size={14} className="animate-spin"/> : <Plus size={14}/>}
                Crear vacante operativa
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
