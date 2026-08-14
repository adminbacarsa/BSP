import React, { useState, useEffect, useCallback } from 'react';
import {
    X, Calendar, Users, MapPin, Search, Send,
    CheckCircle, Clock, ChevronRight,
} from 'lucide-react';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { empresaCollectionQuery } from '@/lib/multiempresa';
import { type Evento, type ServicioEvento } from '@/services/eventoService';
import { solicitudEventoService, type SolicitudEvento } from '@/services/solicitudEventoService';
import { useToast } from '@/context/ToastContext';
import { aptitudTypeService } from '@/services/aptitudTypeService';
import { type AptitudType, type EmpleadoAptitud } from '@/lib/rrhh/aptitudTypes';

// ── Helpers ────────────────────────────────────────────────────────────────

function horarioBadge(s: ServicioEvento): string {
    if (s.tipoTurno === '3x8') return '3×8h';
    if (s.tipoTurno === '2x12') return '2×12h';
    return `${s.horaInicio}–${s.horaFin}`;
}

function fmtFecha(ymd: string): string {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y.slice(2)}`;
}

// Códigos que se consideran "disponibles" (sin turno productivo)
const DISPONIBLE_CODES = new Set(['libre', 'RET', 'F', 'FF', 'FP', 'ESC']);

const AVAIL_LABELS: Record<string, { label: string; cls: string }> = {
    libre:  { label: 'Libre',         cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    RET:    { label: 'Retén',          cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
    F:      { label: 'Franco',         cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
    FF:     { label: 'Franco Fer.',    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
    FP:     { label: 'Franco Perm.',   cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
    ESC:    { label: 'Escuela',        cls: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
    M:      { label: 'Mañana',         cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    T:      { label: 'Tarde',          cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    N:      { label: 'Noche',          cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
    D12:    { label: 'Diurno 12h',     cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    N12:    { label: 'Nocturno 12h',   cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
    V:      { label: 'Vacaciones',     cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
    L:      { label: 'Licencia',       cls: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
    E:      { label: 'Enfermedad',     cls: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' },
    A:      { label: 'Autorizada',     cls: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
    EV:     { label: 'Evento',         cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
};

function getAvail(code: string) {
    return AVAIL_LABELS[code] || { label: code, cls: 'bg-slate-100 text-slate-500' };
}

// ── Types ──────────────────────────────────────────────────────────────────

interface EmpRow {
    id: string;
    uid?: string;
    name: string;
    fileNumber?: string;
    aptitudes?: EmpleadoAptitud[];
}

interface Props {
    evento: Evento;
    empresaId: string;
    onClose: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function EventoDetailModal({ evento, empresaId, onClose }: Props) {
    const { addToast } = useToast();
    const [selectedSrvId, setSelectedSrvId] = useState<string>(evento.servicios?.[0]?.id || '');
    const [empleados, setEmpleados] = useState<EmpRow[]>([]);
    const [availMap, setAvailMap] = useState<Record<string, string>>({});   // empleadoId → código turno | 'libre'
    const [solicitudes, setSolicitudes] = useState<SolicitudEvento[]>([]);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [sending, setSending] = useState(false);
    const [loadingAvail, setLoadingAvail] = useState(false);
    const [tab, setTab] = useState<'convocar' | 'estado'>('convocar');
    const [aptitudCatalog, setAptitudCatalog] = useState<AptitudType[]>([]);
    const [soloRequisitos, setSoloRequisitos] = useState(false);

    const selectedSrv = evento.servicios?.find(s => s.id === selectedSrvId) || null;

    // Cargar empleados activos una vez
    useEffect(() => {
        const q = empresaCollectionQuery('empleados', empresaId, true);
        getDocs(q as ReturnType<typeof query>).then(snap => {
            const rows: EmpRow[] = snap.docs
                .filter(d => {
                    const st = String((d.data() as any).status || 'ACTIVE').toUpperCase();
                    return st === 'ACTIVE' || st === 'ACTIVO';
                })
                .map(d => {
                    const dat = d.data() as any;
                    const name = dat.name
                        || `${dat.firstName || dat.nombre || ''} ${dat.lastName || dat.apellido || ''}`.trim()
                        || d.id;
                    return { id: d.id, uid: dat.uid || '', name, fileNumber: dat.fileNumber || dat.legajo || '', aptitudes: dat.aptitudes || [] };
                })
                .sort((a, b) => a.name.localeCompare(b.name, 'es'));
            setEmpleados(rows);
        }).catch(console.error);
    }, [empresaId]);

    useEffect(() => {
        aptitudTypeService.ensureSeeded(empresaId).then(setAptitudCatalog).catch(() => {});
    }, [empresaId]);

    // Cargar solicitudes del evento
    const loadSolicitudes = useCallback(async () => {
        if (!evento.id) return;
        try {
            const sols = await solicitudEventoService.getByEvento(evento.id);
            setSolicitudes(sols);
        } catch { /* silencioso */ }
    }, [evento.id]);

    useEffect(() => { void loadSolicitudes(); }, [loadSolicitudes]);

    // Cargar disponibilidad al cambiar servicio
    useEffect(() => {
        if (!selectedSrv?.fecha) return;
        setLoadingAvail(true);
        const fecha = selectedSrv.fecha;
        getDocs(
            query(
                collection(db, 'turnos'),
                where('empresaId', '==', empresaId),
                where('startTime', '>=', `${fecha}T00:00:00`),
                where('startTime', '<=', `${fecha}T23:59:59`),
            )
        ).then(snap => {
            const map: Record<string, string> = {};
            snap.docs.forEach(d => {
                const t = d.data();
                if (t.employeeId && !t.draft) map[t.employeeId] = t.code || 'ocupado';
            });
            setAvailMap(map);
        }).catch(console.error).finally(() => setLoadingAvail(false));
    }, [selectedSrvId, empresaId, selectedSrv?.fecha]);

    // Convocar guardias seleccionados
    async function handleConvocar() {
        if (!selectedSrv || selected.size === 0) return;
        setSending(true);
        const convocadoPor = getAuth().currentUser?.uid || '';
        const empMap = Object.fromEntries(empleados.map(e => [e.id, e]));
        try {
            await Promise.all(Array.from(selected).map(async empId => {
                const emp = empMap[empId];
                if (!emp) return;
                await solicitudEventoService.convocar({
                    empresaId,
                    eventoId: evento.id!,
                    eventoNombre: evento.nombre,
                    servicioId: selectedSrv.id,
                    servicioNombre: selectedSrv.nombre,
                    servicioFecha: selectedSrv.fecha,
                    empleadoId: empId,
                    empleadoNombre: emp.name,
                    convocadoPor,
                });
                // Notificación push al portal del guardia
                if (emp.uid) {
                    await addDoc(collection(db, 'user_notifications'), {
                        empresaId,
                        uid: emp.uid,
                        empleadoId: empId,
                        tipo: 'CONVOCATORIA_EVENTO',
                        titulo: `Convocatoria: ${evento.nombre}`,
                        mensaje: `${selectedSrv.nombre} · ${fmtFecha(selectedSrv.fecha)} · ${horarioBadge(selectedSrv)}`,
                        eventoId: evento.id,
                        eventoNombre: evento.nombre,
                        servicioId: selectedSrv.id,
                        read: false,
                        createdAt: serverTimestamp(),
                    });
                }
            }));
            addToast(`Convocatoria enviada a ${selected.size} guardia${selected.size !== 1 ? 's' : ''}`, 'success');
            setSelected(new Set());
            await loadSolicitudes();
            setTab('estado');
        } catch (e) {
            console.error(e);
            addToast('Error al enviar convocatoria', 'error');
        } finally {
            setSending(false);
        }
    }

    // Derivados del servicio seleccionado
    const srvSols = solicitudes.filter(s => s.servicioId === selectedSrvId);
    const aceptaron = srvSols.filter(s => s.status === 'aprobada');
    const pendientes = srvSols.filter(s => s.status === 'convocado' || s.status === 'pendiente');
    const rechazaron = srvSols.filter(s => s.status === 'rechazada');
    const yaEnviadosIds = new Set(srvSols.map(s => s.empleadoId));

    const cupo = selectedSrv?.cupo || 0;

    const aptitudesRequeridas = selectedSrv?.aptitudesRequeridas || [];

    function cumpleRequisitos(emp: EmpRow): boolean {
        if (aptitudesRequeridas.length === 0) return true;
        const empCodigos = new Set((emp.aptitudes || []).map(a => a.codigo));
        return aptitudesRequeridas.every(c => empCodigos.has(c));
    }

    const filteredEmps = empleados.filter(e => {
        if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (soloRequisitos && !cumpleRequisitos(e)) return false;
        return true;
    });

    function toggleEmp(id: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base font-black text-slate-800 dark:text-white truncate">{evento.nombre}</h2>
                        <p className="text-[11px] text-slate-400">{evento.clienteNombre}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                        <X size={16}/>
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden min-h-0">

                    {/* Sidebar: lista de servicios */}
                    <div className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col">
                        <p className="px-3 pt-3 pb-1.5 text-[9px] font-black uppercase text-slate-400 tracking-widest">Servicios</p>
                        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1.5">
                            {(evento.servicios || []).map(srv => {
                                const sSols = solicitudes.filter(s => s.servicioId === srv.id);
                                const pend = sSols.filter(s => s.status === 'convocado' || s.status === 'pendiente').length;
                                const acept = sSols.filter(s => s.status === 'aprobada').length;
                                const isActive = srv.id === selectedSrvId;
                                return (
                                    <button
                                        key={srv.id}
                                        onClick={() => { setSelectedSrvId(srv.id); setTab('convocar'); setSearch(''); setSelected(new Set()); }}
                                        className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${isActive ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-yellow-200 dark:hover:border-yellow-800'}`}
                                    >
                                        <div className="flex items-center justify-between gap-1">
                                            <p className="text-[11px] font-black text-slate-700 dark:text-slate-200 leading-tight truncate">{srv.nombre}</p>
                                            {isActive && <ChevronRight size={10} className="text-yellow-500 shrink-0"/>}
                                        </div>
                                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                                            <span className="text-[8px] text-slate-400 flex items-center gap-0.5"><Calendar size={7}/>{fmtFecha(srv.fecha)}</span>
                                            <span className="text-[8px] bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-1 py-0.5 rounded font-black">{horarioBadge(srv)}</span>
                                        </div>
                                        <div className="flex items-center gap-1 mt-1">
                                            {pend > 0 && <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-black">{pend} pend.</span>}
                                            {acept > 0 && <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded font-black">{acept} ok</span>}
                                            <span className="text-[8px] text-slate-400 ml-auto">{srv.cupo} pax</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Panel principal */}
                    {selectedSrv ? (
                        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                            {/* Cabecera del servicio */}
                            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <span className="font-black text-slate-800 dark:text-white text-sm">{selectedSrv.nombre}</span>
                                    <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 px-2 py-0.5 rounded-full font-black">{horarioBadge(selectedSrv)}</span>
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1"><Calendar size={9}/>{fmtFecha(selectedSrv.fecha)}</span>
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1"><Users size={9}/>{cupo} pax</span>
                                    {selectedSrv.ubicacion?.direccion && (
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[200px]"><MapPin size={9}/>{selectedSrv.ubicacion.direccion}</span>
                                    )}
                                </div>
                                {aptitudesRequeridas.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                        <span className="text-[9px] font-black uppercase text-slate-400">Requiere:</span>
                                        {aptitudesRequeridas.map(codigo => {
                                            const apt = aptitudCatalog.find(a => a.codigo === codigo);
                                            return (
                                                <span key={codigo} className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                                                    {apt?.icono} {apt?.nombre || codigo}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                                {/* Barra progreso confirmados */}
                                <div className="mt-2 flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 rounded-full transition-all"
                                            style={{ width: cupo > 0 ? `${Math.min(100, Math.round(aceptaron.length / cupo * 100))}%` : '0%' }}
                                        />
                                    </div>
                                    <span className="text-[9px] text-slate-400 shrink-0">{aceptaron.length}/{cupo} confirmados</span>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-slate-200 dark:border-slate-700 px-4 shrink-0">
                                {(['convocar', 'estado'] as const).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => setTab(t)}
                                        className={`px-4 py-2.5 text-[11px] font-black transition-colors border-b-2 flex items-center gap-1.5 ${tab === t ? 'border-yellow-500 text-yellow-700 dark:text-yellow-400' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {t === 'convocar' ? 'Convocar guardias' : 'Estado convocatoria'}
                                        {t === 'estado' && srvSols.length > 0 && (
                                            <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full px-1.5 py-0.5 text-[8px]">{srvSols.length}</span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Tab: Convocar */}
                            {tab === 'convocar' && (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    <div className="px-4 py-3 flex items-center gap-3 shrink-0 border-b border-slate-100 dark:border-slate-800 flex-wrap">
                                        <div className="relative flex-1 min-w-32">
                                            <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                            <input
                                                value={search}
                                                onChange={e => setSearch(e.target.value)}
                                                placeholder="Buscar guardia…"
                                                className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:border-yellow-400 dark:focus:border-yellow-600"
                                            />
                                        </div>
                                        {aptitudesRequeridas.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSoloRequisitos(v => !v)}
                                                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-colors ${soloRequisitos ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:border-amber-400'}`}
                                            >
                                                Solo cumplen requisitos
                                            </button>
                                        )}
                                        <button
                                            onClick={() => void handleConvocar()}
                                            disabled={selected.size === 0 || sending}
                                            className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black transition-colors shrink-0"
                                        >
                                            <Send size={11}/>
                                            {sending ? 'Enviando…' : `Convocar${selected.size > 0 ? ` (${selected.size})` : ''}`}
                                        </button>
                                    </div>
                                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
                                        {loadingAvail && (
                                            <p className="text-[11px] text-slate-400 text-center py-4">Cargando disponibilidad…</p>
                                        )}
                                        {!loadingAvail && filteredEmps.map(emp => {
                                            const code = availMap[emp.id] || 'libre';
                                            const avCfg = getAvail(code);
                                            const yaEnviado = yaEnviadosIds.has(emp.id);
                                            const isChecked = selected.has(emp.id);
                                            const disponible = DISPONIBLE_CODES.has(code);
                                            const clickable = !yaEnviado && disponible;
                                            return (
                                                <div
                                                    key={emp.id}
                                                    onClick={() => clickable && toggleEmp(emp.id)}
                                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors
                                                        ${isChecked
                                                            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700'
                                                            : yaEnviado
                                                                ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800 opacity-60'
                                                                : disponible
                                                                    ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-yellow-200 dark:hover:border-yellow-800 cursor-pointer'
                                                                    : 'bg-slate-50 dark:bg-slate-800/30 border-slate-100 dark:border-slate-800 opacity-40 cursor-not-allowed'
                                                        }`}
                                                >
                                                    {/* Checkbox */}
                                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isChecked ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-slate-600'}`}>
                                                        {isChecked && <CheckCircle size={10} className="text-white"/>}
                                                    </div>
                                                    {/* Nombre */}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{emp.name}</p>
                                                        {emp.fileNumber && <p className="text-[9px] text-slate-400">Leg. {emp.fileNumber}</p>}
                                                    </div>
                                                    {/* Chips aptitudes */}
                                                    {(emp.aptitudes || []).length > 0 && (
                                                        <div className="flex flex-wrap gap-0.5 max-w-[120px]">
                                                            {(emp.aptitudes || []).slice(0, 3).map(a => {
                                                                const apt = aptitudCatalog.find(t => t.codigo === a.codigo);
                                                                const cumple = aptitudesRequeridas.includes(a.codigo);
                                                                return (
                                                                    <span
                                                                        key={a.codigo}
                                                                        title={apt?.nombre || a.codigo}
                                                                        className={`text-[8px] px-1 py-0.5 rounded font-bold ${cumple ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}
                                                                    >
                                                                        {apt?.icono || a.codigo}
                                                                    </span>
                                                                );
                                                            })}
                                                            {(emp.aptitudes || []).length > 3 && (
                                                                <span className="text-[8px] text-slate-400">+{(emp.aptitudes || []).length - 3}</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {/* Badge disponibilidad / ya convocado */}
                                                    {yaEnviado ? (
                                                        <span className="text-[8px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-black shrink-0">Convocado</span>
                                                    ) : (
                                                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black shrink-0 ${avCfg.cls}`}>{avCfg.label}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {!loadingAvail && filteredEmps.length === 0 && (
                                            <p className="text-[11px] text-slate-400 text-center py-8">Sin resultados</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Tab: Estado */}
                            {tab === 'estado' && (
                                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                                    {srvSols.length === 0 ? (
                                        <p className="text-[11px] text-slate-400 text-center py-10">Sin convocatorias para este servicio. Usá la solapa "Convocar guardias" para invitar.</p>
                                    ) : (
                                        <>
                                            {aceptaron.length > 0 && (
                                                <section>
                                                    <p className="text-[9px] font-black uppercase text-emerald-600 tracking-wide mb-2">✅ Confirmaron ({aceptaron.length})</p>
                                                    <div className="space-y-1.5">
                                                        {aceptaron.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-xl">
                                                                <CheckCircle size={12} className="text-emerald-500 shrink-0"/>
                                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 flex-1">{sol.empleadoNombre}</p>
                                                                <span className="text-[8px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full font-black">Confirmado</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {pendientes.length > 0 && (
                                                <section>
                                                    <p className="text-[9px] font-black uppercase text-amber-600 tracking-wide mb-2">⏳ Pendientes de respuesta ({pendientes.length})</p>
                                                    <div className="space-y-1.5">
                                                        {pendientes.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl">
                                                                <Clock size={12} className="text-amber-400 shrink-0"/>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200">{sol.empleadoNombre}</p>
                                                                    <p className="text-[9px] text-slate-400">{sol.tipo === 'admin_convoca' ? 'Convocado por admin' : 'Solicitó participar'}</p>
                                                                </div>
                                                                <span className="text-[8px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-black shrink-0">Pendiente</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {rechazaron.length > 0 && (
                                                <section>
                                                    <p className="text-[9px] font-black uppercase text-rose-500 tracking-wide mb-2">❌ Rechazaron ({rechazaron.length})</p>
                                                    <div className="space-y-1.5">
                                                        {rechazaron.map(sol => (
                                                            <div key={sol.id} className="flex items-center gap-3 px-3 py-2.5 bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/30 rounded-xl">
                                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 flex-1">{sol.empleadoNombre}</p>
                                                                <span className="text-[8px] bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded-full font-black shrink-0">Rechazó</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                            Seleccioná un servicio
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
