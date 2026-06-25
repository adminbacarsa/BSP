import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Toaster, toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, onSnapshot, doc, getDoc, addDoc } from 'firebase/firestore';
import {
  Shield, Clock, CheckCircle, XCircle, Users, AlertCircle,
  ChevronRight, RefreshCw, Plus, X, MessageSquare, User
} from 'lucide-react';
import {
  solicitudRefuerzoService,
  SolicitudRefuerzo,
  SolicitudEstado,
} from '@/services/solicitudRefuerzoService';
import { Timestamp } from 'firebase/firestore';

// ─── helpers ───────────────────────────────────────────────────────────────

function fmtTs(ts: Timestamp | string | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as string);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

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

// ─── Página principal ────────────────────────────────────────────────────────

export default function SupervisionPage() {
  const { user, isSuperAdmin } = useAuth();
  const { empresaId } = useEmpresa();

  const [solicitudes, setSolicitudes] = useState<SolicitudRefuerzo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'PENDIENTE' | 'TODAS'>('PENDIENTE');
  const [rechazarTarget, setRechazarTarget] = useState<SolicitudRefuerzo | null>(null);
  const [aprobarTarget, setAprobarTarget] = useState<SolicitudRefuerzo | null>(null);
  const [supervisorObjetivos, setSupervisorObjetivos] = useState<string[]>([]);

  // Cargar objetivos asignados al supervisor actual
  useEffect(() => {
    if (!user?.uid || isSuperAdmin) return;
    getDoc(doc(db, 'system_users', user.uid)).then(snap => {
      if (snap.exists()) setSupervisorObjetivos(snap.data().objetivosAsignados || []);
    });
  }, [user?.uid, isSuperAdmin]);

  // Suscripción en tiempo real
  useEffect(() => {
    if (!empresaId) return;
    setLoading(true);
    const unsub = solicitudRefuerzoService.subscribeByEmpresa(empresaId, items => {
      if (isSuperAdmin) {
        setSolicitudes(items);
      } else {
        // Supervisor ve solo sus objetivos
        setSolicitudes(items.filter(s => supervisorObjetivos.includes(s.objectiveId)));
      }
      setLoading(false);
    });
    return () => unsub();
  }, [empresaId, isSuperAdmin, supervisorObjetivos]);

  const pendientes = solicitudes.filter(s => s.estado === 'PENDIENTE');
  const visibles = tab === 'PENDIENTE' ? pendientes : solicitudes;

  // Crea los turnos reales en Firestore al aprobar una solicitud
  async function crearTurnosParaSolicitud(sol: SolicitudRefuerzo): Promise<string[]> {
    const nextDayDate = (dateStr: string) => {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    };
    const isOvernight = sol.endTime < sol.startTime;
    const fechaFin = isOvernight ? nextDayDate(sol.fecha) : sol.fecha;
    const startISO = `${sol.fecha}T${sol.startTime}:00`;
    const endISO   = `${fechaFin}T${sol.endTime}:00`;

    const base = {
      empresaId:           sol.empresaId,
      objectiveId:         sol.objectiveId,
      clientId:            sol.clientId,
      clientName:          sol.clientName,
      objectiveName:       sol.objectiveName,
      fecha:               sol.fecha,
      startTime:           startISO,
      endTime:             endISO,
      origin:              'CLIENT_REQUEST',
      solicitudRefuerzoId: sol.id,
      shiftCode:           'REF',
      isPresent:           false,
      isAbsent:            false,
      isCompleted:         false,
      draft:               false,
    };

    const ids: string[] = [];
    if (sol.tipo === 'AGREGADO_TURNO') {
      const ref = await addDoc(collection(db, 'turnos'), {
        ...base,
        employeeId:    sol.parentEmpleadoId  ?? null,
        employeeName:  sol.parentEmpleadoName ?? null,
        parentShiftId: sol.parentShiftId      ?? null,
      });
      ids.push(ref.id);
    } else {
      // REFUERZO_PUESTO: una vacante por pax solicitado
      const n = sol.cantidadPax ?? 1;
      for (let i = 0; i < n; i++) {
        const ref = await addDoc(collection(db, 'turnos'), {
          ...base,
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
    try {
      toast.loading('Aprobando y generando turno…', { id: 'aprobar' });
      const turnoIds = await crearTurnosParaSolicitud(aprobarTarget);
      const estadoFinal = aprobarTarget.tipo === 'AGREGADO_TURNO' ? 'ASIGNADA' : 'APROBADA';
      await solicitudRefuerzoService.update(aprobarTarget.id, {
        estado:              estadoFinal,
        autorizadoPorUid:    user.uid,
        autorizadoPorNombre: user.displayName || user.email || '',
        autorizadoAt:        Timestamp.now(),
        turnoIds,
        ...(nota ? { notaInterna: nota } as any : {}),
      });
      toast.success(
        turnoIds.length === 1
          ? `Aprobada — turno creado (${turnoIds[0].slice(0, 6)}…)`
          : `Aprobada — ${turnoIds.length} turnos creados`,
        { id: 'aprobar' },
      );
    } catch (e: any) {
      toast.error(`Error: ${e?.message || 'No se pudo aprobar'}`, { id: 'aprobar' });
    }
    setAprobarTarget(null);
  }, [aprobarTarget, user]);

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

  return (
    <DashboardLayout>
      <Head><title>Supervisión — COSP</title></Head>
      <Toaster richColors position="top-right"/>

      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-teal-50 dark:bg-teal-900/30 rounded-xl text-teal-600 dark:text-teal-400">
              <Shield size={22}/>
            </div>
            <div>
              <h1 className="font-black text-xl text-slate-900 dark:text-white uppercase tracking-tight">Supervisión</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {isSuperAdmin ? 'Todas las solicitudes' : `${supervisorObjetivos.length} objetivo${supervisorObjetivos.length !== 1 ? 's' : ''} asignado${supervisorObjetivos.length !== 1 ? 's' : ''}`}
                {' · '}{pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(['PENDIENTE', 'TODAS'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-colors ${
                tab === t ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-white dark:bg-slate-800 border text-slate-500 hover:bg-slate-50'
              }`}
            >
              {t === 'PENDIENTE' ? `Pendientes (${pendientes.length})` : `Todas (${solicitudes.length})`}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
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
            {visibles.map(s => (
              <div key={s.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {tipoBadge(s.tipo)}
                      {estadoBadge(s.estado)}
                      <span className="text-[9px] text-slate-400 font-mono">{fmtTs(s.solicitadoAt)}</span>
                    </div>
                    <p className="font-black text-sm text-slate-800 dark:text-white truncate">{s.objectiveName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{s.clientName}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                        📅 {s.fecha} · {s.startTime}–{s.endTime}
                      </span>
                      {s.tipo === 'REFUERZO_PUESTO' && s.cantidadPax && (
                        <span className="text-xs text-orange-600 font-bold">+{s.cantidadPax} pax</span>
                      )}
                      {s.tipo === 'AGREGADO_TURNO' && s.parentEmpleadoName && (
                        <span className="text-xs text-violet-600 font-bold flex items-center gap-1"><User size={10}/>{s.parentEmpleadoName}</span>
                      )}
                    </div>
                    {s.motivo && (
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1">
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

                  {/* Acciones — solo para PENDIENTE */}
                  {s.estado === 'PENDIENTE' && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setRechazarTarget(s)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl font-black text-xs transition-colors flex items-center gap-1"
                      ><XCircle size={13}/> Rechazar</button>
                      <button
                        onClick={() => setAprobarTarget(s)}
                        className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-xl font-black text-xs transition-colors flex items-center gap-1"
                      ><CheckCircle size={13}/> Aprobar</button>
                    </div>
                  )}
                  {s.estado === 'APROBADA' && (
                    <span className="text-[10px] text-teal-600 font-bold shrink-0">✓ {s.autorizadoPorNombre}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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
    </DashboardLayout>
  );
}
