import React, { useState, useEffect, useCallback } from 'react';
import {
    Plus, Trash2, Edit2, X, Save,
    Calendar, ChevronLeft, ChevronRight, Users, CheckCircle, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { getAuth } from 'firebase/auth';
import {
    eventoService,
    buildFechasFromServicios,
    calcHorasServicio,
    type Evento,
    type ServicioEvento,
    type TipoTurnoEvento,
} from '@/services/eventoService';
import { solicitudEventoService, type SolicitudEvento } from '@/services/solicitudEventoService';
import { slaService } from '@/services/slaService';
import { useToast } from '@/context/ToastContext';
import { EventoDetailModal } from './EventoDetailModal';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtFecha(ymd: string): string {
    if (!ymd) return '—';
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y.slice(2)}`;
}

function fmtFechaRango(ev: Evento): string {
    const fechas = [ev.fecha, ...(ev.fechas || [])].filter(Boolean).sort();
    if (fechas.length === 0) return '—';
    if (fechas.length === 1) return fmtFecha(fechas[0]);
    return `${fmtFecha(fechas[0])} – ${fmtFecha(fechas[fechas.length - 1])}`;
}

function yyyyMm(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mesLabel(mes: string): string {
    const [y, m] = mes.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; ring: string; text: string }> = {
    borrador:  { label: 'Borrador',  ring: 'bg-slate-100 dark:bg-slate-700',         text: 'text-slate-500 dark:text-slate-300' },
    abierto:   { label: 'Abierto',   ring: 'bg-blue-100 dark:bg-blue-900/30',         text: 'text-blue-700 dark:text-blue-300' },
    en_curso:  { label: 'En curso',  ring: 'bg-yellow-100 dark:bg-yellow-900/30',     text: 'text-yellow-700 dark:text-yellow-300' },
    ejecutado: { label: 'Ejecutado', ring: 'bg-green-100 dark:bg-green-900/30',       text: 'text-green-700 dark:text-green-300' },
    cancelado: { label: 'Cancelado', ring: 'bg-rose-100 dark:bg-rose-900/30',         text: 'text-rose-700 dark:text-rose-400' },
    activo:    { label: 'Activo',    ring: 'bg-blue-100 dark:bg-blue-900/30',         text: 'text-blue-700 dark:text-blue-300' },
};

const TURNO_LABELS: Record<TipoTurnoEvento, string> = {
    '3x8':  '3 × 8 h',
    '2x12': '2 × 12 h',
    'libre': 'Horario libre',
};

// ── Default forms ──────────────────────────────────────────────────────────

function emptyEvento(): Partial<Evento> {
    return { nombre: '', descripcion: '', clienteId: '', clienteNombre: '', status: 'borrador', servicios: [] };
}

function emptySrv(defaultFecha?: string): Partial<ServicioEvento> {
    return {
        nombre: '',
        fecha: defaultFecha || new Date().toISOString().slice(0, 10),
        tipoTurno: 'libre',
        horaInicio: '08:00',
        horaFin: '20:00',
        ubicacion: { tipo: 'nueva', direccion: '' },
        cupo: 1,
        requisitos: '',
        instrucciones: '',
        status: 'pendiente',
    };
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
    empresaId: string;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function EventosPanel({ empresaId, canCreate, canUpdate, canDelete }: Props) {
    const { addToast } = useToast();

    // ── View state ──────────────────────────────────────────────────────────

    const [panelView, setPanelView] = useState<'list' | 'form'>('list');
    const [editingId, setEditingId] = useState<string | null>(null);

    // ── List state ──────────────────────────────────────────────────────────

    const [eventos, setEventos] = useState<Evento[]>([]);
    const [loading, setLoading] = useState(false);
    const [detailEvento, setDetailEvento] = useState<Evento | null>(null);
    const [mes, setMes] = useState(() => yyyyMm(new Date()));
    const [filterCliente, setFilterCliente] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [clients, setClients] = useState<Array<{ id: string; name: string; objectives: any[] }>>([]);

    // ── Form state ──────────────────────────────────────────────────────────

    const [form, setForm] = useState<Partial<Evento>>(emptyEvento());
    const [formServicios, setFormServicios] = useState<ServicioEvento[]>([]);
    const [saving, setSaving] = useState(false);

    // ── Service sub-form state ──────────────────────────────────────────────

    const [srvFormOpen, setSrvFormOpen] = useState(false);
    const [editingSrvId, setEditingSrvId] = useState<string | null>(null);

    // ── Solicitudes state ───────────────────────────────────────────────────

    const [solicitudesMap, setSolicitudesMap] = useState<Record<string, SolicitudEvento[]>>({});
    const [expandedSolicitudes, setExpandedSolicitudes] = useState<Record<string, boolean>>({});
    const [respondiendo, setRespondiendo] = useState<string | null>(null);

    // ── Staffing state (personal asignado por evento) ───────────────────────

    type StaffingRow = { id: string; empleadoId: string; empleadoNombre: string; servicioId: string; servicioNombre: string; fecha: string };
    const [staffingMap, setStaffingMap] = useState<Record<string, StaffingRow[]>>({});
    const [expandedStaffing, setExpandedStaffing] = useState<Record<string, boolean>>({});
    const [loadingStaffing, setLoadingStaffing] = useState<Record<string, boolean>>({});

    async function loadStaffing(ev: Evento) {
        if (!ev.id) return;
        setLoadingStaffing(prev => ({ ...prev, [ev.id!]: true }));
        try {
            const rows = await eventoService.getStaffing(ev.id!);
            setStaffingMap(prev => ({ ...prev, [ev.id!]: rows }));
        } catch { /* silencioso */ } finally {
            setLoadingStaffing(prev => ({ ...prev, [ev.id!]: false }));
        }
    }

    function toggleStaffing(ev: Evento) {
        if (!ev.id) return;
        const next = !expandedStaffing[ev.id];
        setExpandedStaffing(prev => ({ ...prev, [ev.id!]: next }));
        if (next && !staffingMap[ev.id]) void loadStaffing(ev);
    }
    const [srvForm, setSrvForm] = useState<Partial<ServicioEvento>>(emptySrv());

    // ── Load clients once ───────────────────────────────────────────────────

    useEffect(() => {
        if (!empresaId) return;
        slaService.getClients({ empresaId, scopeEmpresa: true }).then(setClients).catch(console.error);
    }, [empresaId]);

    // ── Load eventos for current month ──────────────────────────────────────

    const loadEventos = useCallback(async () => {
        if (!empresaId) return;
        setLoading(true);
        const [yr, mo] = mes.split('-').map(Number);
        const from = `${yr}-${String(mo).padStart(2, '0')}-01`;
        const lastDay = new Date(yr, mo, 0).getDate();
        const to = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        try {
            const evs = await eventoService.getByEmpresaAndRange(empresaId, from, to, true);
            setEventos(evs);
        } finally {
            setLoading(false);
        }
    }, [empresaId, mes]);

    useEffect(() => { void loadEventos(); }, [loadEventos]);

    // Cargar solicitudes de los eventos visibles
    useEffect(() => {
        if (eventos.length === 0) return;
        Promise.all(
            eventos.filter(ev => ev.id).map(ev =>
                solicitudEventoService.getByEvento(ev.id!).then(sols => ({ id: ev.id!, sols }))
            )
        ).then(results => {
            const map: Record<string, SolicitudEvento[]> = {};
            results.forEach(({ id, sols }) => { map[id] = sols; });
            setSolicitudesMap(map);
        }).catch(() => {});
    }, [eventos]);

    const handleResponder = async (sol: SolicitudEvento, status: 'aprobada' | 'rechazada') => {
        if (!sol.id) return;
        setRespondiendo(sol.id);
        try {
            const uid = getAuth().currentUser?.uid || '';
            await solicitudEventoService.responder(sol.id, status, uid);
            setSolicitudesMap(prev => {
                const sols = (prev[sol.eventoId] || []).map(s =>
                    s.id === sol.id ? { ...s, status } : s
                );
                return { ...prev, [sol.eventoId]: sols };
            });
            addToast(status === 'aprobada' ? 'Solicitud aprobada' : 'Solicitud rechazada', 'success');
        } catch {
            addToast('Error al responder la solicitud', 'error');
        } finally {
            setRespondiendo(null);
        }
    };

    // ── Month navigation ────────────────────────────────────────────────────

    function navMes(delta: number) {
        const [y, m] = mes.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        setMes(yyyyMm(d));
    }

    // ── Form open/close ─────────────────────────────────────────────────────

    function openNew() {
        setEditingId(null);
        setForm(emptyEvento());
        setFormServicios([]);
        setSrvFormOpen(false);
        setEditingSrvId(null);
        setSrvForm(emptySrv());
        setPanelView('form');
    }

    function openEdit(ev: Evento) {
        setEditingId(ev.id || null);
        setForm({
            nombre: ev.nombre,
            descripcion: ev.descripcion || '',
            clienteId: ev.clienteId,
            clienteNombre: ev.clienteNombre,
            status: ev.status,
        });
        setFormServicios([...(ev.servicios || [])]);
        setSrvFormOpen(false);
        setEditingSrvId(null);
        setSrvForm(emptySrv());
        setPanelView('form');
    }

    function closeForm() {
        setPanelView('list');
        setEditingId(null);
        setSrvFormOpen(false);
    }

    // ── Service sub-form actions ────────────────────────────────────────────

    function openAddSrv() {
        const lastFecha = formServicios[formServicios.length - 1]?.fecha;
        setEditingSrvId(null);
        setSrvForm(emptySrv(lastFecha));
        setSrvFormOpen(true);
    }

    function openEditSrv(srv: ServicioEvento) {
        setEditingSrvId(srv.id);
        setSrvForm({ ...srv });
        setSrvFormOpen(true);
    }

    function cancelSrvForm() {
        setSrvFormOpen(false);
        setEditingSrvId(null);
        setSrvForm(emptySrv());
    }

    function saveSrv() {
        const { nombre, fecha, tipoTurno, cupo } = srvForm;
        if (!nombre?.trim() || !fecha || !tipoTurno || !cupo) {
            addToast('Completá los campos requeridos del servicio', 'error');
            return;
        }
        const horasTotal = calcHorasServicio(srvForm as ServicioEvento);
        const srv: ServicioEvento = {
            id: editingSrvId || crypto.randomUUID(),
            nombre: nombre.trim(),
            fecha,
            tipoTurno,
            horaInicio: srvForm.horaInicio || '00:00',
            horaFin: srvForm.horaFin || '00:00',
            horasTotal,
            ubicacion: srvForm.ubicacion || { tipo: 'nueva', direccion: '' },
            cupo: Number(cupo),
            requisitos: srvForm.requisitos || '',
            instrucciones: srvForm.instrucciones || '',
            status: 'pendiente',
        };
        if (editingSrvId) {
            setFormServicios(prev => prev.map(s => s.id === editingSrvId ? srv : s));
        } else {
            setFormServicios(prev => [...prev, srv]);
        }
        cancelSrvForm();
    }

    function removeSrv(id: string) {
        setFormServicios(prev => prev.filter(s => s.id !== id));
    }

    // ── Save evento ─────────────────────────────────────────────────────────

    async function saveEvento() {
        if (!form.nombre?.trim()) { addToast('El evento necesita un nombre', 'error'); return; }
        if (!form.clienteId)      { addToast('Seleccioná un cliente', 'error'); return; }
        if (formServicios.length === 0) { addToast('Agregá al menos un servicio al evento', 'error'); return; }

        setSaving(true);
        const { fecha, fechas } = buildFechasFromServicios(formServicios);
        const payload: Omit<Evento, 'id'> = {
            empresaId,
            nombre: form.nombre.trim(),
            descripcion: form.descripcion || '',
            clienteId: form.clienteId,
            clienteNombre: form.clienteNombre || '',
            fecha,
            fechas,
            servicios: formServicios,
            status: (form.status as Evento['status']) || 'borrador',
            creadoPor: getAuth().currentUser?.uid || '',
        };
        try {
            if (editingId) {
                await eventoService.update(editingId, payload);
                addToast('Evento actualizado', 'success');
            } else {
                await eventoService.add(payload);
                addToast('Evento creado', 'success');
            }
            await loadEventos();
            closeForm();
        } catch (e) {
            console.error(e);
            addToast('Error al guardar el evento', 'error');
        } finally {
            setSaving(false);
        }
    }

    // ── Cancel evento ───────────────────────────────────────────────────────

    async function cancelEvento(ev: Evento) {
        if (!ev.id) return;
        if (!confirm(`¿Cancelar el evento "${ev.nombre}"?`)) return;
        try {
            await eventoService.cancel(ev.id);
            setEventos(prev => prev.map(e => e.id === ev.id ? { ...e, status: 'cancelado' } : e));
            addToast('Evento cancelado', 'success');
        } catch {
            addToast('Error al cancelar el evento', 'error');
        }
    }

    async function deleteEvento(ev: Evento) {
        if (!ev.id) return;
        if (!confirm(`¿Eliminar definitivamente el evento "${ev.nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
            await eventoService.delete(ev.id);
            setEventos(prev => prev.filter(e => e.id !== ev.id));
            addToast('Evento eliminado', 'success');
        } catch {
            addToast('Error al eliminar el evento', 'error');
        }
    }

    // ── Derived list ────────────────────────────────────────────────────────

    const filtered = eventos.filter(ev => {
        if (filterCliente !== 'all' && ev.clienteId !== filterCliente) return false;
        if (filterStatus !== 'all' && ev.status !== filterStatus) return false;
        return true;
    });

    const clienteDelForm = clients.find(c => c.id === form.clienteId);
    const objetivosDisponibles: any[] = clienteDelForm?.objectives || [];

    // ── RENDER: form ────────────────────────────────────────────────────────

    if (panelView === 'form') {
        return (
            <div className="space-y-5">

                {/* Back + title */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={closeForm}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                    >
                        <ChevronLeft size={16}/>
                    </button>
                    <h2 className="text-sm font-black text-slate-700 dark:text-white uppercase tracking-wide">
                        {editingId ? 'Editar evento' : 'Nuevo evento'}
                    </h2>
                </div>

                {/* ── Datos del evento ──────────────────────────────────── */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-1 h-4 rounded-full bg-yellow-400"/>
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Datos del evento</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Nombre *</label>
                            <input
                                value={form.nombre || ''}
                                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                                placeholder="Ej: Pumas vs Nueva Zelanda"
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-bold text-slate-800 dark:text-white placeholder-slate-300 outline-none focus:border-yellow-400 dark:focus:border-yellow-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Cliente *</label>
                            <select
                                value={form.clienteId || ''}
                                onChange={e => {
                                    const c = clients.find(c => c.id === e.target.value);
                                    setForm(f => ({ ...f, clienteId: e.target.value, clienteNombre: c?.name || '' }));
                                }}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400 dark:focus:border-yellow-500"
                            >
                                <option value="">Seleccionar cliente...</option>
                                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Estado</label>
                            <select
                                value={form.status || 'borrador'}
                                onChange={e => setForm(f => ({ ...f, status: e.target.value as Evento['status'] }))}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400 dark:focus:border-yellow-500"
                            >
                                <option value="borrador">Borrador</option>
                                <option value="abierto">Abierto</option>
                                <option value="en_curso">En curso</option>
                                <option value="ejecutado">Ejecutado</option>
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Descripción</label>
                            <textarea
                                value={form.descripcion || ''}
                                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                                rows={2}
                                placeholder="Descripción del evento..."
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-700 dark:text-white placeholder-slate-300 outline-none focus:border-yellow-400 dark:focus:border-yellow-500 resize-none"
                            />
                        </div>
                    </div>
                </div>

                {/* ── Servicios del evento ──────────────────────────────── */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="w-1 h-4 rounded-full bg-yellow-400"/>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Servicios del evento</span>
                            {formServicios.length > 0 && (
                                <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-[10px] font-black rounded-full">
                                    {formServicios.length}
                                </span>
                            )}
                        </div>
                        {!srvFormOpen && (
                            <button
                                onClick={openAddSrv}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800 rounded-xl text-xs font-black uppercase hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors"
                            >
                                <Plus size={12}/> Agregar servicio
                            </button>
                        )}
                    </div>

                    {/* Services table */}
                    {formServicios.length > 0 && (
                        <div className="overflow-x-auto mb-4">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-700">
                                        <th className="pb-2 text-left font-bold text-slate-400 pr-3">Nombre</th>
                                        <th className="pb-2 text-left font-bold text-slate-400 pr-3">Fecha</th>
                                        <th className="pb-2 text-left font-bold text-slate-400 pr-3">Turno</th>
                                        <th className="pb-2 text-left font-bold text-slate-400 pr-3">Horario</th>
                                        <th className="pb-2 text-center font-bold text-slate-400 pr-3">Cupo</th>
                                        <th className="pb-2 text-left font-bold text-slate-400">Ubicación</th>
                                        <th className="pb-2"/>
                                    </tr>
                                </thead>
                                <tbody>
                                    {formServicios.map(srv => (
                                        <tr key={srv.id} className="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                            <td className="py-2 pr-3 font-bold text-slate-700 dark:text-slate-200 max-w-[160px] truncate">{srv.nombre}</td>
                                            <td className="py-2 pr-3 text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">{fmtFecha(srv.fecha)}</td>
                                            <td className="py-2 pr-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{TURNO_LABELS[srv.tipoTurno]}</td>
                                            <td className="py-2 pr-3 text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                                                {srv.tipoTurno === 'libre'
                                                    ? `${srv.horaInicio}–${srv.horaFin}`
                                                    : `${srv.horasTotal} h`}
                                            </td>
                                            <td className="py-2 pr-3 text-center font-black text-slate-700 dark:text-slate-200">{srv.cupo}</td>
                                            <td className="py-2 text-slate-400 max-w-[130px] truncate">
                                                {srv.ubicacion.tipo === 'objetivo_existente'
                                                    ? (srv.ubicacion.objectiveNombre || '—')
                                                    : (srv.ubicacion.direccion || 'Nueva ubicación')}
                                            </td>
                                            <td className="py-2 pl-2">
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => openEditSrv(srv)}
                                                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                                    >
                                                        <Edit2 size={12}/>
                                                    </button>
                                                    <button
                                                        onClick={() => removeSrv(srv.id)}
                                                        className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 text-slate-400 hover:text-rose-500 transition-colors"
                                                    >
                                                        <Trash2 size={12}/>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {formServicios.length === 0 && !srvFormOpen && (
                        <div className="text-center py-6 text-slate-400 text-sm">
                            <Calendar size={24} className="mx-auto mb-2 opacity-30"/>
                            Sin servicios. Agregá al menos uno.
                        </div>
                    )}

                    {/* ── Service sub-form ───────────────────────────────── */}
                    {srvFormOpen && (
                        <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 space-y-3 mt-2">
                            <div className="text-[10px] font-black uppercase tracking-wider text-yellow-700 dark:text-yellow-400 mb-1">
                                {editingSrvId ? 'Editar servicio' : 'Nuevo servicio'}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {/* Nombre */}
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Nombre *</label>
                                    <input
                                        value={srvForm.nombre || ''}
                                        onChange={e => setSrvForm(f => ({ ...f, nombre: e.target.value }))}
                                        placeholder="Ej: Cobertura hotel – día previo"
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white placeholder-slate-300 outline-none focus:border-yellow-400"
                                    />
                                </div>
                                {/* Fecha */}
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Fecha *</label>
                                    <input
                                        type="date"
                                        value={srvForm.fecha || ''}
                                        onChange={e => setSrvForm(f => ({ ...f, fecha: e.target.value }))}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                    />
                                </div>
                                {/* Tipo turno */}
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tipo de turno *</label>
                                    <select
                                        value={srvForm.tipoTurno || 'libre'}
                                        onChange={e => {
                                            const t = e.target.value as TipoTurnoEvento;
                                            setSrvForm(f => ({
                                                ...f,
                                                tipoTurno: t,
                                                horaInicio: t === 'libre' ? (f.horaInicio || '08:00') : '00:00',
                                                horaFin:    t === 'libre' ? (f.horaFin    || '20:00') : '00:00',
                                            }));
                                        }}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                    >
                                        <option value="libre">Horario libre</option>
                                        <option value="3x8">3 × 8 h (24 h continuo)</option>
                                        <option value="2x12">2 × 12 h (24 h continuo)</option>
                                    </select>
                                </div>
                                {/* Horario libre */}
                                {srvForm.tipoTurno === 'libre' && (
                                    <>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Hora inicio</label>
                                            <input
                                                type="time"
                                                value={srvForm.horaInicio || '08:00'}
                                                onChange={e => setSrvForm(f => ({ ...f, horaInicio: e.target.value }))}
                                                className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Hora fin</label>
                                            <input
                                                type="time"
                                                value={srvForm.horaFin || '20:00'}
                                                onChange={e => setSrvForm(f => ({ ...f, horaFin: e.target.value }))}
                                                className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                            />
                                        </div>
                                    </>
                                )}
                                {/* Cupo */}
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Cupo (guardias) *</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={srvForm.cupo || 1}
                                        onChange={e => setSrvForm(f => ({ ...f, cupo: Number(e.target.value) }))}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                    />
                                </div>
                                {/* Tipo ubicación */}
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Tipo de ubicación</label>
                                    <select
                                        value={srvForm.ubicacion?.tipo || 'nueva'}
                                        onChange={e => setSrvForm(f => ({
                                            ...f,
                                            ubicacion: {
                                                tipo: e.target.value as 'nueva' | 'objetivo_existente',
                                                direccion: '',
                                                objectiveId: '',
                                                objectiveNombre: '',
                                            },
                                        }))}
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                    >
                                        <option value="nueva">Nueva ubicación</option>
                                        <option value="objetivo_existente">Objetivo existente</option>
                                    </select>
                                </div>
                                {/* Ubicación detalle */}
                                {srvForm.ubicacion?.tipo === 'objetivo_existente' ? (
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Objetivo</label>
                                        <select
                                            value={srvForm.ubicacion?.objectiveId || ''}
                                            onChange={e => {
                                                const obj = objetivosDisponibles.find((o: any) => o.id === e.target.value);
                                                setSrvForm(f => ({
                                                    ...f,
                                                    ubicacion: {
                                                        tipo: 'objetivo_existente',
                                                        objectiveId: e.target.value,
                                                        objectiveNombre: obj?.name || '',
                                                    },
                                                }));
                                            }}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-white outline-none focus:border-yellow-400"
                                        >
                                            <option value="">Seleccionar objetivo...</option>
                                            {objetivosDisponibles.map((obj: any) => (
                                                <option key={obj.id} value={obj.id}>{obj.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div className="md:col-span-2">
                                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Dirección / Venue</label>
                                        <input
                                            value={srvForm.ubicacion?.direccion || ''}
                                            onChange={e => setSrvForm(f => ({
                                                ...f,
                                                ubicacion: { tipo: 'nueva', direccion: e.target.value },
                                            }))}
                                            placeholder="Ej: Estadio Kempes, Córdoba"
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs text-slate-800 dark:text-white placeholder-slate-300 outline-none focus:border-yellow-400"
                                        />
                                    </div>
                                )}
                                {/* Requisitos */}
                                <div className="md:col-span-3">
                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Requisitos / Instrucciones</label>
                                    <input
                                        value={srvForm.requisitos || ''}
                                        onChange={e => setSrvForm(f => ({ ...f, requisitos: e.target.value }))}
                                        placeholder="Ej: Portación de arma, credencial vigente..."
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs text-slate-700 dark:text-white placeholder-slate-300 outline-none focus:border-yellow-400"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={saveSrv}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl text-xs font-black uppercase transition-colors"
                                >
                                    <Save size={12}/> {editingSrvId ? 'Actualizar' : 'Agregar'}
                                </button>
                                <button
                                    onClick={cancelSrvForm}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl text-xs font-black uppercase hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                >
                                    <X size={12}/> Cancelar
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer actions ────────────────────────────────────── */}
                <div className="flex items-center justify-end gap-3 pb-4">
                    <button
                        onClick={closeForm}
                        className="px-4 py-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => void saveEvento()}
                        disabled={saving}
                        className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-60 text-white rounded-xl font-black text-xs uppercase shadow-sm transition-colors"
                    >
                        <Save size={13}/> {saving ? 'Guardando...' : (editingId ? 'Actualizar evento' : 'Crear evento')}
                    </button>
                </div>
            </div>
        );
    }

    // ── RENDER: list ────────────────────────────────────────────────────────

    return (
        <div className="space-y-4">

            {/* Controls row */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                {/* Month nav */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navMes(-1)}
                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        <ChevronLeft size={14}/>
                    </button>
                    <span className="text-sm font-black text-slate-700 dark:text-white capitalize w-40 text-center">
                        {mesLabel(mes)}
                    </span>
                    <button
                        onClick={() => navMes(1)}
                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                        <ChevronRight size={14}/>
                    </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {/* Client filter */}
                    <select
                        value={filterCliente}
                        onChange={e => setFilterCliente(e.target.value)}
                        className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-white outline-none"
                    >
                        <option value="all">Todos los clientes</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {/* Status filter */}
                    <select
                        value={filterStatus}
                        onChange={e => setFilterStatus(e.target.value)}
                        className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-white outline-none"
                    >
                        <option value="all">Todos los estados</option>
                        <option value="borrador">Borrador</option>
                        <option value="abierto">Abierto</option>
                        <option value="en_curso">En curso</option>
                        <option value="ejecutado">Ejecutado</option>
                        <option value="cancelado">Cancelado</option>
                    </select>
                    {canCreate && (
                        <button
                            onClick={openNew}
                            className="flex items-center gap-1.5 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-black text-xs uppercase shadow-sm transition-colors"
                        >
                            <Plus size={12}/> Nuevo evento
                        </button>
                    )}
                </div>
            </div>

            {/* Events grid */}
            {loading ? (
                <div className="text-center py-10 text-sm text-slate-400">Cargando...</div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                    <Calendar size={28} className="mx-auto text-slate-300 dark:text-slate-600"/>
                    <p className="text-sm text-slate-400">No hay eventos en {mesLabel(mes)}</p>
                    {canCreate && (
                        <button
                            onClick={openNew}
                            className="text-xs font-black uppercase text-yellow-600 hover:text-yellow-700 dark:text-yellow-400"
                        >
                            + Crear el primero
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map(ev => {
                        const sc = STATUS_CONFIG[ev.status] || STATUS_CONFIG.borrador;
                        const totalCupo = (ev.servicios || []).reduce((acc, s) => acc + s.cupo, 0);
                        const nSrv = (ev.servicios || []).length;
                        const sols = solicitudesMap[ev.id!] || [];
                        const pendientes = sols.filter(s => s.status === 'pendiente').length;
                        const solExpanded = expandedSolicitudes[ev.id!] || false;
                        const staffRows = staffingMap[ev.id!] || [];
                        const staffExpanded = expandedStaffing[ev.id!] || false;
                        const staffLoading = loadingStaffing[ev.id!] || false;
                        const totalAsignados = staffRows.length;
                        return (
                            <div
                                key={ev.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:border-yellow-300 dark:hover:border-yellow-700 transition-colors"
                            >
                                <div className="p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="text-sm font-black text-slate-800 dark:text-white leading-tight">{ev.nombre}</h3>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {pendientes > 0 && (
                                                <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 rounded-full text-[9px] font-black">
                                                    {pendientes} sol.
                                                </span>
                                            )}
                                            {totalCupo > 0 && (
                                                <button
                                                    onClick={() => toggleStaffing(ev)}
                                                    className={`px-1.5 py-0.5 rounded-full text-[9px] font-black transition-colors ${totalAsignados >= totalCupo ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : totalAsignados > 0 ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}
                                                    title="Ver personal asignado"
                                                >
                                                    {totalAsignados}/{totalCupo} pax
                                                </button>
                                            )}
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${sc.ring} ${sc.text}`}>
                                                {sc.label}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                        <div className="font-bold text-slate-600 dark:text-slate-300">{ev.clienteNombre}</div>
                                        <div className="flex items-center gap-1">
                                            <Calendar size={11}/> {fmtFechaRango(ev)}
                                        </div>
                                        {nSrv > 0 && (
                                            <div className="flex items-center gap-3">
                                                <span>{nSrv} {nSrv === 1 ? 'servicio' : 'servicios'}</span>
                                                {totalCupo > 0 && <><span>·</span><span>{totalCupo} pax total</span></>}
                                            </div>
                                        )}
                                        {ev.descripcion && (
                                            <p className="text-slate-400 line-clamp-2 pt-0.5">{ev.descripcion}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 pt-1 border-t border-slate-50 dark:border-slate-700">
                                        {/* Botón principal: Gestionar (abre modal de convocatoria/asignación) */}
                                        {ev.status !== 'cancelado' && (ev.servicios || []).length > 0 && (
                                            <button
                                                onClick={() => setDetailEvento(ev)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl text-xs font-black uppercase transition-colors shadow-sm"
                                            >
                                                <Users size={11}/> Gestionar
                                            </button>
                                        )}
                                        {(canUpdate || canCreate) && ev.status !== 'cancelado' && (
                                            <button
                                                onClick={() => openEdit(ev)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-black uppercase hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                                            >
                                                <Edit2 size={11}/> Editar
                                            </button>
                                        )}
                                        {sols.length > 0 && (
                                            <button
                                                onClick={() => setExpandedSolicitudes(prev => ({ ...prev, [ev.id!]: !solExpanded }))}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800/50 rounded-xl text-xs font-black uppercase hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition-colors ml-auto"
                                            >
                                                <Users size={11}/> {sols.length} solicitud{sols.length > 1 ? 'es' : ''}
                                                {solExpanded ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
                                            </button>
                                        )}
                                        {canDelete && ev.status !== 'cancelado' && (
                                            <button
                                                onClick={() => void cancelEvento(ev)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-900/20 text-rose-500 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 rounded-xl text-xs font-black uppercase hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                                            >
                                                <X size={11}/> Cancelar
                                            </button>
                                        )}
                                        {canDelete && ev.status === 'cancelado' && (
                                            <button
                                                onClick={() => void deleteEvento(ev)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-black uppercase hover:bg-rose-200 dark:hover:bg-rose-900/60 transition-colors"
                                            >
                                                <Trash2 size={11}/> Eliminar
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {/* Panel de solicitudes */}
                                {solExpanded && sols.length > 0 && (
                                    <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                                        <div className="px-4 py-2 text-[10px] font-black uppercase text-slate-400 tracking-wide">Solicitudes de guardias</div>
                                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {sols.map(sol => (
                                                <div key={sol.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{sol.empleadoNombre}</p>
                                                        <p className="text-[10px] text-slate-400 truncate">{sol.servicioNombre} · {sol.servicioFecha}</p>
                                                    </div>
                                                    {sol.status === 'pendiente' ? (
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                onClick={() => void handleResponder(sol, 'aprobada')}
                                                                disabled={respondiendo === sol.id}
                                                                className="flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg text-[10px] font-black hover:bg-emerald-200 disabled:opacity-50 transition-colors"
                                                            >
                                                                <CheckCircle size={10}/> Aprobar
                                                            </button>
                                                            <button
                                                                onClick={() => void handleResponder(sol, 'rechazada')}
                                                                disabled={respondiendo === sol.id}
                                                                className="flex items-center gap-1 px-2 py-1 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-lg text-[10px] font-black hover:bg-rose-200 disabled:opacity-50 transition-colors"
                                                            >
                                                                <XCircle size={10}/> Rechazar
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${sol.status === 'aprobada' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400'}`}>
                                                            {sol.status === 'aprobada' ? 'Aprobada' : 'Rechazada'}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* Panel personal asignado */}
                                {staffExpanded && (
                                    <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                                        <div className="px-4 py-2 flex items-center justify-between">
                                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wide">Personal asignado</span>
                                            <button onClick={() => void loadStaffing(ev)} className="text-[9px] text-slate-400 hover:text-slate-600">↺ actualizar</button>
                                        </div>
                                        {staffLoading ? (
                                            <div className="px-4 pb-3 text-[10px] text-slate-400">Cargando…</div>
                                        ) : staffRows.length === 0 ? (
                                            <div className="px-4 pb-3 text-[10px] text-slate-400">Sin guardias asignados aún</div>
                                        ) : (
                                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {(ev.servicios || []).map(srv => {
                                                    const assigned = staffRows.filter(r => r.servicioId === srv.id || (!r.servicioId && srv.id === ev.id));
                                                    const pct = srv.cupo > 0 ? Math.min(100, Math.round(assigned.length / srv.cupo * 100)) : 0;
                                                    return (
                                                        <div key={srv.id} className="px-4 py-2.5">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <span className="text-[10px] font-black text-slate-600 dark:text-slate-300 truncate">{srv.nombre}</span>
                                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ml-2 shrink-0 ${assigned.length >= srv.cupo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                                    {assigned.length}/{srv.cupo}
                                                                </span>
                                                            </div>
                                                            {/* Barra de progreso */}
                                                            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full mb-1.5 overflow-hidden">
                                                                <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-400' : 'bg-slate-300'}`} style={{ width: `${pct}%` }}/>
                                                            </div>
                                                            {assigned.length > 0 && (
                                                                <div className="flex flex-wrap gap-1 mt-1">
                                                                    {assigned.map(r => (
                                                                        <span key={r.id} className="text-[9px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
                                                                            {r.empleadoNombre}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal de gestión de evento (convocatoria) */}
            {detailEvento && (
                <EventoDetailModal
                    evento={detailEvento}
                    empresaId={empresaId}
                    onClose={() => setDetailEvento(null)}
                />
            )}
        </div>
    );
}
