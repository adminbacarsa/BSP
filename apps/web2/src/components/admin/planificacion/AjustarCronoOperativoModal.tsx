import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, Zap, Users } from 'lucide-react';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';
import type { AjustarCronoOperativoProps } from '@/types/ajustesCrono.types';
import {
    applyAjusteOperativoMasivo,
    eachDayInRange,
    flattenObjetivosFromClients,
    gridHasPendingInRange,
    previewAjusteOperativoMasivo,
    type AjusteOperativoPreviewSlot,
} from '@/lib/ajustesCrono/ajustesCronoService';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterRowsByEmpresa, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';

const MOTIVOS_RAPIDOS = ['Evento especial', 'Refuerzo operativo', 'Fin de semana'];

function toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseInputDate(s: string): Date {
    return new Date(s + 'T12:00:00');
}

function fmtCorto(d: Date): string {
    return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function AjustarCronoOperativoModal({
    open,
    onClose,
    empresaId,
    fechaInicial,
    fechaHastaInicial,
    objetivoInicial,
    clients: clientsProp,
    gridSnapshot,
}: AjustarCronoOperativoProps & { clients?: any[] }) {
    const [fechaDesde, setFechaDesde] = useState('');
    const [fechaHasta, setFechaHasta] = useState('');
    const [destinoId, setDestinoId] = useState('');
    const [motivo, setMotivo] = useState('');
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const [progress, setProgress] = useState('');
    const [totalRetenes, setTotalRetenes] = useState(0);
    const [slotsValidos, setSlotsValidos] = useState(0);
    const [slotsOmitidos, setSlotsOmitidos] = useState<AjusteOperativoPreviewSlot[]>([]);
    const [clients, setClients] = useState<any[]>(clientsProp || []);

    const servicio = objetivoInicial;

    useEffect(() => {
        if (clientsProp?.length) setClients(clientsProp);
    }, [clientsProp]);

    useEffect(() => {
        if (!open) return;
        const desde = fechaInicial ?? new Date();
        const hasta = fechaHastaInicial ?? desde;
        setFechaDesde(toInputDate(desde));
        setFechaHasta(toInputDate(hasta));
        setMotivo('');
        setDestinoId('');
        setTotalRetenes(0);
        setSlotsValidos(0);
        setSlotsOmitidos([]);
    }, [open, fechaInicial, fechaHastaInicial]);

    useEffect(() => {
        if (!open || clientsProp?.length || !empresaId) return;
        const scope = shouldScopeQueriesToEmpresa(empresaId);
        getDocs(
            scope
                ? query(collection(db, 'clients'), where('empresaId', '==', empresaId))
                : collection(db, 'clients'),
        ).then(snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setClients(filterRowsByEmpresa(rows, empresaId, scope, true));
        }).catch(() => {});
    }, [open, clientsProp, empresaId]);

    const objetivos = useMemo(() => flattenObjetivosFromClients(clients), [clients]);

    const objetivoNombres = useMemo(() => {
        const m = new Map<string, string>();
        for (const o of objetivos) m.set(o.id, o.nombre);
        if (servicio?.id) m.set(servicio.id, servicio.nombre);
        return m;
    }, [objetivos, servicio]);

    const objectiveIds = servicio?.id ? [servicio.id] : [];

    const desdeDate = fechaDesde ? parseInputDate(fechaDesde) : null;
    const hastaDate = fechaHasta ? parseInputDate(fechaHasta) : null;
    const dias = useMemo(() => {
        if (!desdeDate || !hastaDate || hastaDate < desdeDate) return [];
        return eachDayInRange(desdeDate, hastaDate);
    }, [desdeDate, hastaDate]);

    const destinoSel = objetivos.find(o => o.id === destinoId);

    useEffect(() => {
        if (!open || !servicio?.id || !desdeDate || !hastaDate || dias.length === 0) {
            setTotalRetenes(0);
            setSlotsValidos(0);
            setSlotsOmitidos([]);
            return;
        }
        if (hastaDate < desdeDate) return;

        let cancelled = false;
        setLoadingPreview(true);
        previewAjusteOperativoMasivo([servicio.id], objetivoNombres, desdeDate, hastaDate, gridSnapshot)
            .then(({ slots, totalRetenes: total }) => {
                if (cancelled) return;
                setTotalRetenes(total);
                setSlotsValidos(slots.filter(s => s.valido).length);
                setSlotsOmitidos(slots.filter(s => !s.valido));
            })
            .catch(() => {
                if (!cancelled) toast.error('Error al calcular preview.');
            })
            .finally(() => { if (!cancelled) setLoadingPreview(false); });
        return () => { cancelled = true; };
    }, [open, servicio?.id, fechaDesde, fechaHasta, objetivoNombres, dias.length, gridSnapshot]);

    const hayCambiosSinGuardar = useMemo(() => {
        if (!servicio?.id || !desdeDate || !hastaDate) return false;
        return gridHasPendingInRange(gridSnapshot, servicio.id, desdeDate, hastaDate);
    }, [gridSnapshot, servicio?.id, desdeDate, hastaDate]);

    const handleConfirm = async () => {
        if (!desdeDate || !hastaDate || !servicio?.id || totalRetenes === 0) return;
        if (hayCambiosSinGuardar) {
            toast.error('Guardá la planificación antes de comprimir (hay cambios sin guardar en el rango).');
            return;
        }
        const auth = getAuth();
        const creadoPor = auth.currentUser?.email || auth.currentUser?.displayName || 'admin';
        setSaving(true);
        setProgress('Iniciando…');
        try {
            const res = await applyAjusteOperativoMasivo({
                empresaId,
                creadoPor,
                fechaInicio: desdeDate,
                fechaFin: hastaDate,
                objectiveIds: [servicio.id],
                objetivoNombres,
                motivo: motivo.trim() || 'Evento — ajuste operativo',
                destinoObjetivoId: destinoId || undefined,
                destinoObjetivoNombre: destinoSel?.nombre,
                onProgress: setProgress,
            });
            if (res.retenesLiberados === 0) {
                toast.error('No se pudo liberar ningún guardia en el rango elegido.');
                return;
            }
            toast.success(`${res.retenesLiberados} guardia(s) liberados a RET · ${res.slotsAplicados} día(s)`);
            onClose();
        } catch (e: any) {
            toast.error(e?.message || 'Error al aplicar.');
        } finally {
            setSaving(false);
            setProgress('');
        }
    };

    if (!open || typeof document === 'undefined') return null;

    const rangoInvalido = !!desdeDate && !!hastaDate && hastaDate < desdeDate;
    const puedeAplicar = !loadingPreview && !rangoInvalido && totalRetenes > 0 && !!servicio?.id && !saving && !hayCambiosSinGuardar;

    return createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white w-full max-w-lg max-h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-4 border-b bg-violet-50">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="font-black text-lg flex items-center gap-2 text-violet-900">
                                <Zap className="text-violet-600" size={20} />
                                Ajustar Crono
                            </h3>
                            <p className="text-[11px] text-violet-600/80 mt-0.5">
                                Comprime este servicio a 12h y libera guardias a RET (M→D12, N→N12, T→RET automático).
                            </p>
                        </div>
                        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {servicio ? (
                        <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2">
                            <p className="text-[10px] font-black uppercase text-violet-500">Servicio</p>
                            <p className="font-bold text-sm text-violet-900">{servicio.nombre}</p>
                        </div>
                    ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                            Seleccioná un objetivo en la grilla antes de ajustar el cronograma.
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Desde</label>
                            <input
                                type="date"
                                value={fechaDesde}
                                onChange={e => setFechaDesde(e.target.value)}
                                className="w-full border rounded-xl px-3 py-2 text-sm font-bold"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Hasta</label>
                            <input
                                type="date"
                                value={fechaHasta}
                                min={fechaDesde}
                                onChange={e => setFechaHasta(e.target.value)}
                                className="w-full border rounded-xl px-3 py-2 text-sm font-bold"
                            />
                        </div>
                    </div>

                    {dias.length > 0 && !rangoInvalido && (
                        <p className="text-[10px] text-slate-500 font-bold">
                            {dias.length} día{dias.length !== 1 ? 's' : ''}: {fmtCorto(dias[0])}
                            {dias.length > 1 && ` → ${fmtCorto(dias[dias.length - 1])}`}
                        </p>
                    )}

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Destino / evento (opcional)</label>
                        <select
                            value={destinoId}
                            onChange={e => setDestinoId(e.target.value)}
                            className="w-full border rounded-xl px-3 py-2 text-sm"
                        >
                            <option value="">Pool RET — sin destino fijo</option>
                            {objetivos.filter(o => o.id !== servicio?.id).map(o => (
                                <option key={o.id} value={o.id}>{o.nombre}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Motivo</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {MOTIVOS_RAPIDOS.map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMotivo(m)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border transition-colors ${
                                        motivo === m ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-500'
                                    }`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                        <input
                            type="text"
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            placeholder="Ej: Evento fin de semana"
                            className="w-full border rounded-xl px-3 py-2 text-sm"
                        />
                    </div>

                    <div className={`rounded-xl p-4 border ${totalRetenes > 0 ? 'bg-teal-50 border-teal-200' : 'bg-slate-50 border-slate-200'}`}>
                        {loadingPreview ? (
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 size={16} className="animate-spin" /> Calculando…
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-2 mb-2">
                                    <Users className="text-teal-600" size={18} />
                                    <span className="font-black text-2xl text-teal-800">{totalRetenes}</span>
                                    <span className="text-sm font-bold text-teal-700">guardias a RET</span>
                                </div>
                                <p className="text-xs text-slate-600">
                                    {slotsValidos} día(s) con banda Tarde · {dias.length - slotsValidos} omitido(s)
                                </p>
                                {slotsOmitidos.length > 0 && (
                                    <ul className="mt-2 space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                                        {slotsOmitidos.map(s => (
                                            <li key={s.fecha.toISOString()} className="text-[10px] text-amber-700">
                                                {fmtCorto(s.fecha)}: {s.omitido || 'sin dotación M+T+N'}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {totalRetenes === 0 && servicio?.id && !loadingPreview && (
                                    <p className="text-xs text-amber-700 flex items-center gap-1 mt-2">
                                        <AlertTriangle size={14} />
                                        En esos días no hay banda Tarde planificada — no se puede liberar RET.
                                    </p>
                                )}
                                {hayCambiosSinGuardar && (
                                    <p className="text-xs text-amber-800 flex items-center gap-1 mt-2 font-bold">
                                        <AlertTriangle size={14} />
                                        Hay cambios sin guardar en la grilla. Guardá antes de aplicar.
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    {saving && progress && (
                        <p className="text-xs text-violet-600 font-bold animate-pulse">{progress}</p>
                    )}
                </div>

                <div className="p-4 border-t bg-slate-50 flex gap-2">
                    <button type="button" onClick={onClose} disabled={saving} className="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-200">
                        Cancelar
                    </button>
                    <button
                        type="button"
                        disabled={!puedeAplicar}
                        onClick={handleConfirm}
                        className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                        Comprimir y liberar {totalRetenes > 0 ? totalRetenes : ''} RET
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
