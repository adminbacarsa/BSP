import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Zap, Loader2, AlertTriangle, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';
import type { AjustarCronoCoberturaProps, EstrategiaCobertura } from '@/types/ajustesCrono.types';
import {
    applyCoberturaAusenciaAutomatica,
    eachDayInRange,
    flattenObjetivosFromClients,
    resolveAusenciaCoberturaContext,
    type AusenciaCoberturaContext,
} from '@/lib/ajustesCrono/ajustesCronoService';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { filterRowsByEmpresa, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';

function parseAusenciaDate(v: Date | string): Date {
    if (v instanceof Date) return v;
    return new Date(String(v).slice(0, 10) + 'T12:00:00');
}

function fmtRange(start: Date, end: Date): string {
    const dias = eachDayInRange(start, end).length;
    const a = start.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    const b = end.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    return `${a} al ${b} (${dias} días)`;
}

const TIPO_LABEL: Record<string, string> = {
    VACACIONES: 'Vacaciones',
    LICENCIA: 'Licencia',
    AUSENCIA: 'Ausencia',
    ENFERMEDAD: 'Enfermedad',
};

export default function AjustarCronoCoberturaModal({
    open,
    onClose,
    empresaId,
    ausencia,
    clients: clientsProp,
    readOnly = false,
}: AjustarCronoCoberturaProps & { clients?: any[]; readOnly?: boolean }) {
    const [estrategia, setEstrategia] = useState<EstrategiaCobertura>('COMPRIMIR_12H');
    const [motivo, setMotivo] = useState('');
    const [ctx, setCtx] = useState<AusenciaCoberturaContext | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [clients, setClients] = useState<any[]>(clientsProp || []);

    const startDate = useMemo(() => parseAusenciaDate(ausencia.startDate), [ausencia.startDate]);
    const endDate = useMemo(() => parseAusenciaDate(ausencia.endDate), [ausencia.endDate]);
    const dias = useMemo(() => eachDayInRange(startDate, endDate).length, [startDate, endDate]);

    useEffect(() => {
        if (clientsProp?.length) setClients(clientsProp);
    }, [clientsProp]);

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

    const objetivoNombres = useMemo(() => {
        const m = new Map<string, string>();
        for (const o of flattenObjetivosFromClients(clients)) m.set(o.id, o.nombre);
        return m;
    }, [clients]);

    useEffect(() => {
        if (!open) return;
        setEstrategia('COMPRIMIR_12H');
        setMotivo('');
        setCtx(null);
    }, [open, ausencia.id]);

    useEffect(() => {
        if (!open || readOnly) return;
        let cancelled = false;
        setLoading(true);
        resolveAusenciaCoberturaContext(
            ausencia.employeeId,
            startDate,
            endDate,
            objetivoNombres,
        )
            .then(data => { if (!cancelled) setCtx(data); })
            .catch(() => { if (!cancelled) toast.error('Error al analizar la ausencia.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, ausencia.employeeId, startDate, endDate, objetivoNombres, readOnly]);

    const handleConfirm = async () => {
        if (readOnly) { onClose(); return; }
        const auth = getAuth();
        const creadoPor = auth.currentUser?.email || auth.currentUser?.displayName || 'admin';
        setSaving(true);
        try {
            await applyCoberturaAusenciaAutomatica({
                empresaId,
                creadoPor,
                ausenciaId: ausencia.id,
                employeeId: ausencia.employeeId,
                employeeName: ausencia.employeeName,
                startDate,
                endDate,
                tipo: ausencia.tipo,
                estrategia,
                motivo,
            });
            toast.success(
                estrategia === 'VACANTE'
                    ? 'Ausencia marcada como vacante en cronograma.'
                    : `Cronograma ajustado — ${dias} día(s) cubiertos con 12h.`,
            );
            onClose();
        } catch (e: any) {
            toast.error(e?.message || 'Error al aplicar cobertura.');
        } finally {
            setSaving(false);
        }
    };

    if (!open || typeof document === 'undefined') return null;

    const puedeComprimir = ctx?.propuesta.valido === true;
    const puedeAplicar = !readOnly && !loading && !saving && (
        estrategia === 'VACANTE' || (estrategia === 'COMPRIMIR_12H' && puedeComprimir)
    );

    return createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-800 w-full max-w-lg max-h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-4 border-b dark:border-slate-700 bg-teal-50 dark:bg-teal-950/30">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="font-black text-lg flex items-center gap-2 text-teal-900 dark:text-teal-100">
                                <Zap className="text-teal-600" size={20} />
                                {readOnly ? 'Cobertura aplicada' : 'Ajustar Crono — cobertura'}
                            </h3>
                            <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 mt-0.5">
                                {readOnly
                                    ? 'Resumen del ajuste registrado para esta ausencia.'
                                    : 'Comprime automáticamente el servicio a 12h mientras el guardia está ausente.'}
                            </p>
                        </div>
                        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-[10px] font-black uppercase text-slate-400">Guardia ausente</p>
                            <p className="font-bold uppercase text-slate-900 dark:text-white truncate">{ausencia.employeeName}</p>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase text-slate-400">Tipo</p>
                            <p className="font-bold text-slate-800 dark:text-slate-200">{TIPO_LABEL[ausencia.tipo] || ausencia.tipo}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-[10px] font-black uppercase text-slate-400">Período</p>
                            <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                <CalendarDays size={14} className="text-teal-600" />
                                {fmtRange(startDate, endDate)}
                            </p>
                        </div>
                    </div>

                    {loading && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="animate-spin text-teal-500" />
                        </div>
                    )}

                    {!loading && ctx && (
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 border dark:border-slate-700 text-sm">
                            <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Servicio</p>
                            <p className="font-bold">{ctx.objectiveNombre}</p>
                            <p className="text-xs text-slate-500 mt-1">
                                {ctx.turnosAusente} turno(s) del ausente · banda habitual {ctx.bandaAusente}
                            </p>
                        </div>
                    )}

                    {!readOnly && (
                        <>
                            <div className="space-y-2">
                                <label className={`flex gap-3 p-3 border rounded-xl cursor-pointer ${estrategia === 'COMPRIMIR_12H' ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20' : 'border-slate-200 dark:border-slate-600'}`}>
                                    <input
                                        type="radio"
                                        name="estrategia"
                                        checked={estrategia === 'COMPRIMIR_12H'}
                                        onChange={() => setEstrategia('COMPRIMIR_12H')}
                                        className="mt-1 accent-teal-600"
                                    />
                                    <div>
                                        <p className="font-black text-xs uppercase">Comprimir a 12h (automático)</p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Los compañeros pasan a D12+N12 por todo el período. Recomendado.
                                        </p>
                                    </div>
                                </label>
                                <label className={`flex gap-3 p-3 border rounded-xl cursor-pointer ${estrategia === 'VACANTE' ? 'border-amber-500 bg-amber-50/50' : 'border-slate-200 dark:border-slate-600'}`}>
                                    <input
                                        type="radio"
                                        name="estrategia"
                                        checked={estrategia === 'VACANTE'}
                                        onChange={() => setEstrategia('VACANTE')}
                                        className="mt-1 accent-amber-600"
                                    />
                                    <div>
                                        <p className="font-black text-xs uppercase">Marcar como vacante</p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Sin ajuste de compañeros. Operaciones verá el puesto descubierto.
                                        </p>
                                    </div>
                                </label>
                            </div>

                            {estrategia === 'COMPRIMIR_12H' && ctx && (
                                <div className={`rounded-xl p-4 border ${puedeComprimir ? 'bg-teal-50 border-teal-200' : 'bg-amber-50 border-amber-200'}`}>
                                    {puedeComprimir ? (
                                        <>
                                            <p className="font-black text-teal-800 text-lg">
                                                {ctx.propuesta.filas.filter(f => f.bandaAjuste !== f.bandaOriginal).length} compañero(s)
                                                → 12h
                                            </p>
                                            <p className="text-xs text-teal-700 mt-1">
                                                ~{ctx.turnosAComprimir} turnos actualizados en {dias} días
                                            </p>
                                            <p className="text-[10px] text-teal-600/70 mt-2">
                                                Cobertura D12 + N12 automática · sin elegir guardias
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-xs text-amber-800 flex items-start gap-2">
                                            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                            {ctx.propuesta.errores.join(' ') || 'No se puede comprimir este servicio.'}
                                        </p>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Nota (opcional)</label>
                                <input
                                    type="text"
                                    value={motivo}
                                    onChange={e => setMotivo(e.target.value)}
                                    placeholder={`Ej: ${TIPO_LABEL[ausencia.tipo] || 'Ausencia'} — ${ausencia.employeeName.split(',')[0]}`}
                                    className="w-full border dark:border-slate-600 rounded-xl px-3 py-2 text-sm dark:bg-slate-700 dark:text-white"
                                />
                            </div>
                        </>
                    )}

                    {readOnly && ctx && (
                        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-sm text-teal-800">
                            <p>Servicio: <span className="font-bold">{ctx.objectiveNombre}</span></p>
                            <p className="mt-1">{dias} días · {ctx.turnosAusente} turnos del ausente marcados</p>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                    >
                        {readOnly ? 'Cerrar' : 'Cancelar'}
                    </button>
                    {!readOnly && (
                        <button
                            type="button"
                            disabled={!puedeAplicar}
                            onClick={handleConfirm}
                            className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                            {estrategia === 'VACANTE' ? 'Marcar vacante' : 'Ajustar crono y cubrir'}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
