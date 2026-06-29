import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, BarChart2, CheckCircle2, AlertTriangle, Eye, Zap, BookOpen, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export interface EquilibrarProposedChange {
    empId: string;
    dateStr: string;
    positionName: string;
    code: string;
    name: string;
    hours: number;
    startTimeStr: string;
    endTimeStr: string;
}

interface Props {
    open: boolean;
    onClose: () => void;
    empresaId: string;
    objectiveId: string;
    objectiveNombre: string;
    year: number;
    month: number;
    /** Lista de empleados del objetivo para mostrar nombres */
    employees: { id: string; name?: string; nombre?: string }[];
    /** Cuando el usuario confirma, recibe los cambios para inyectarlos en pendingChanges */
    onApplyPending?: (changes: EquilibrarProposedChange[]) => void;
}

interface EquilibrarOutput {
    ok: boolean;
    empleadosRotados: number;
    bloquesProcesados: number;
    turnosActualizados: number;
    horasAntes: Record<string, number>;
    horasDespues: Record<string, number>;
    errores: string[];
    dryRun?: boolean;
    proposedChanges?: EquilibrarProposedChange[];
    isPublished?: boolean;
    wasPublished?: boolean;
    puestosEncontrados?: string[];
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export default function EquilibrarCronoModal({ open, onClose, empresaId, objectiveId, objectiveNombre, year, month, employees, onApplyPending }: Props) {
    const [running, setRunning]         = useState(false);
    const [preview, setPreview]         = useState<EquilibrarOutput | null>(null);
    const [result, setResult]           = useState<EquilibrarOutput | null>(null);
    const [puestosExentos, setPuestosExentos] = useState<Set<string>>(new Set());
    const [exclusionesChanged, setExclusionesChanged] = useState(false);

    useEffect(() => {
        if (open) {
            setPreview(null);
            setResult(null);
            setRunning(false);
            setPuestosExentos(new Set());
            setExclusionesChanged(false);
        }
    }, [open]);

    const empMap: Record<string, string> = {};
    employees.forEach(e => { empMap[e.id] = e.name || e.nombre || e.id; });

    const runPreview = useCallback(async (exentos: Set<string>) => {
        setRunning(true);
        setPreview(null);
        setResult(null);
        setExclusionesChanged(false);
        try {
            const fn = httpsCallable<object, EquilibrarOutput>(functions, 'runEquilibrarCrono');
            const res = await fn({
                empresaId, objectiveId, year, month, dryRun: true,
                puestosExentos: exentos.size > 0 ? [...exentos] : undefined,
            });
            setPreview(res.data);
        } catch (e: any) {
            toast.error(e?.message || 'Error al previsualizar.');
        } finally {
            setRunning(false);
        }
    }, [empresaId, objectiveId, year, month]);

    const handlePreview = () => runPreview(puestosExentos);

    const toggleExento = (puesto: string) => {
        setPuestosExentos(prev => {
            const next = new Set(prev);
            if (next.has(puesto)) next.delete(puesto); else next.add(puesto);
            return next;
        });
        setExclusionesChanged(true);
    };

    const handleApply = () => {
        if (!preview?.proposedChanges?.length) return;
        if (onApplyPending) {
            // Inyectar en pendingChanges del padre — GUARDAR/DESCARTAR funcionan normalmente
            onApplyPending(preview.proposedChanges);
            onClose();
            toast.success(
                `${preview.empleadosRotados} empleados rotados · ${preview.proposedChanges.length} cambios pendientes.\n` +
                `Revisá el cronograma y usá GUARDAR o DESCARTAR.`,
                { duration: 6000 },
            );
        }
    };

    const handleReset = () => {
        setPreview(null);
        setResult(null);
    };

    if (!open || typeof document === 'undefined') return null;

    const current = result ?? preview;
    const isPreview = !!preview && !result;

    return createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white w-full max-w-lg max-h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b bg-emerald-50">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="font-black text-lg flex items-center gap-2 text-emerald-900">
                                <BarChart2 className="text-emerald-600" size={20} />
                                Equilibrar horas
                                {isPreview && (
                                    <span className="text-[10px] font-black uppercase bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5">
                                        Vista previa
                                    </span>
                                )}
                            </h3>
                            <p className="text-[11px] text-emerald-700/80 mt-0.5">
                                Rota posiciones por bloque de trabajo para igualar horas entre todos los empleados del objetivo.
                            </p>
                        </div>
                        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {/* Objetivo + mes */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                            <p className="text-[10px] font-black uppercase text-emerald-500">Objetivo</p>
                            <p className="font-bold text-sm text-emerald-900 truncate">{objectiveNombre}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                            <p className="text-[10px] font-black uppercase text-slate-400">Período</p>
                            <p className="font-bold text-sm text-slate-700">{MESES[month - 1]} {year}</p>
                        </div>
                    </div>

                    {/* Descripción del algoritmo */}
                    {!current && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                            <p className="font-black text-slate-700 mb-1">¿Qué hace?</p>
                            <ul className="space-y-0.5 list-disc list-inside">
                                <li>Detecta los bloques de trabajo (rachas de 6 días) de cada empleado.</li>
                                <li>Por cada bloque, rota quién cubre qué posición: el de menos horas acumuladas toma la posición más pesada (EN, RO).</li>
                                <li>Puede cambiar de banda (M → N) entre bloques — el franco garantiza el descanso.</li>
                                <li>Primero muestra una <strong>vista previa</strong> — podés revisar y confirmar o descartar.</li>
                            </ul>
                        </div>
                    )}

                    {/* Preview banner */}
                    {isPreview && (
                        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                            <Eye size={15} className="text-amber-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-black text-[12px] text-amber-800">Vista previa — sin cambios aplicados</p>
                                <p className="text-[11px] text-amber-700">Revisá el impacto en horas y confirmá para guardar los cambios.</p>
                            </div>
                        </div>
                    )}

                    {/* Aviso plan publicado */}
                    {isPreview && preview!.isPublished && (
                        <div className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 flex items-start gap-2">
                            <BookOpen size={14} className="text-orange-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-orange-800">
                                <span className="font-black">El cronograma está publicado.</span> Al confirmar, se moverá automáticamente a <span className="font-black">BORRADOR</span> para que puedas revisar y volver a publicar.
                            </p>
                        </div>
                    )}

                    {/* Aviso plan movido a BORRADOR tras aplicar */}
                    {result && result.wasPublished && (
                        <div className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 flex items-start gap-2">
                            <BookOpen size={14} className="text-blue-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-blue-800">
                                <span className="font-black">Plan movido a BORRADOR.</span> Los cambios se aplicaron. Revisá el cronograma y volvé a publicar cuando esté listo.
                            </p>
                        </div>
                    )}

                    {/* Resultado */}
                    {current && (
                        <div className="space-y-3">
                            {(() => {
                                const noData = !current.ok && current.errores?.[0]?.includes('No se encontraron turnos');
                                const alreadyOk = current.ok && current.turnosActualizados === 0;
                                // Horas excedentes sobre 200h
                                const excesoAntes   = Object.values(current.horasAntes).reduce((s, h) => s + Math.max(0, h - 200), 0);
                                const excesoDespues = Object.values(current.horasDespues).reduce((s, h) => s + Math.max(0, h - 200), 0);
                                const ahorroExceso  = Math.round(excesoAntes - excesoDespues);
                                return (
                                <div className={`rounded-xl border-2 px-3 py-2.5 ${result && current.turnosActualizados > 0 ? 'border-emerald-300 bg-emerald-50' : isPreview && current.turnosActualizados > 0 ? 'border-amber-200 bg-amber-50' : noData ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {result ? <CheckCircle2 size={16} className="text-emerald-600" /> : isPreview ? <Eye size={16} className="text-amber-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
                                        <span className="font-black text-sm text-slate-800">
                                            {current.turnosActualizados > 0
                                                ? `${current.turnosActualizados} turnos ${isPreview ? 'a actualizar' : 'actualizados'} · ${current.empleadosRotados} empleados rotados`
                                                : noData ? 'El cronograma no está guardado aún'
                                                : alreadyOk ? 'Las horas ya están equilibradas'
                                                : current.errores?.[0] || 'Sin cambios necesarios'}
                                        </span>
                                    </div>
                                    {noData ? (
                                        <>
                                            <p className="text-[11px] text-amber-700 font-medium">Guardá el borrador del crono (botón <strong>Guardar</strong>) y luego volvé a equilibrar.</p>
                                            <p className="text-[10px] text-amber-600/70 mt-0.5 font-mono">{current.errores?.[0]}</p>
                                        </>
                                    ) : (
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <p className="text-[10px] text-slate-500">{current.bloquesProcesados} bloques procesados</p>
                                            {excesoAntes > 0 && (
                                                <p className="text-[10px] font-black text-rose-600">
                                                    Hs sobre 200h: {Math.round(excesoAntes)}h → {Math.round(excesoDespues)}h
                                                    {ahorroExceso > 0 && <span className="text-emerald-600 ml-1">(−{ahorroExceso}h excedente)</span>}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                                );
                            })()}

                            {/* Tabla antes/después */}
                            {current.turnosActualizados > 0 && (() => {
                                const empIds = Object.keys(current.horasAntes).sort((a, b) =>
                                    (current.horasDespues[b] || 0) - (current.horasDespues[a] || 0));
                                return (
                                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-slate-50 text-slate-600">
                                                <tr>
                                                    <th className="text-left px-3 py-1.5 font-black uppercase">Empleado</th>
                                                    <th className="text-right px-3 py-1.5 font-black uppercase">Antes</th>
                                                    <th className="text-right px-3 py-1.5 font-black uppercase">{isPreview ? 'Sería' : 'Después'}</th>
                                                    <th className="text-right px-3 py-1.5 font-black uppercase">Δ</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {empIds.map(id => {
                                                    const antes   = Math.round(current.horasAntes[id] || 0);
                                                    const despues = Math.round(current.horasDespues[id] || 0);
                                                    const delta   = despues - antes;
                                                    return (
                                                        <tr key={id} className="border-t border-slate-100">
                                                            <td className="px-3 py-1.5 font-bold text-slate-700">{empMap[id] || id}</td>
                                                            <td className="px-3 py-1.5 text-right font-mono text-slate-500">{antes}h</td>
                                                            <td className={`px-3 py-1.5 text-right font-mono font-black ${despues > 190 ? 'text-rose-700' : 'text-slate-800'}`}>{despues}h</td>
                                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                                                {delta > 0 ? `+${delta}` : delta}h
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })()}

                            {current.errores?.length > 0 && current.turnosActualizados > 0 && (
                                <p className="text-[10px] text-amber-700 font-bold">{current.errores.join(' · ')}</p>
                            )}

                            {/* Excluir puestos de la rotación */}
                            {current.puestosEncontrados && current.puestosEncontrados.length > 1 && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Excluir puestos de la rotación</p>
                                    <div className="space-y-1">
                                        {current.puestosEncontrados.map(puesto => (
                                            <label key={puesto} className="flex items-center gap-2 cursor-pointer group">
                                                <input
                                                    type="checkbox"
                                                    checked={puestosExentos.has(puesto)}
                                                    onChange={() => toggleExento(puesto)}
                                                    className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
                                                />
                                                <span className={`text-[11px] font-medium ${puestosExentos.has(puesto) ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                                    {puesto}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                    {puestosExentos.size > 0 && (
                                        <p className="text-[10px] text-amber-700 mt-2">
                                            {puestosExentos.size === 1 ? '1 puesto excluido' : `${puestosExentos.size} puestos excluidos`} — recalculá para ver el impacto.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-slate-50 flex gap-2">
                    {/* Estado inicial: botón "Previsualizar" */}
                    {!current && (
                        <>
                            <button type="button" onClick={onClose} disabled={running}
                                className="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-200">
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={running}
                                onClick={handlePreview}
                                className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                {running ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                                {running ? 'Calculando…' : 'Previsualizar cambios'}
                            </button>
                        </>
                    )}

                    {/* Estado preview: descartar / recalcular / confirmar */}
                    {isPreview && (
                        <>
                            <button type="button" onClick={handleReset} disabled={running}
                                className="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-200">
                                Descartar
                            </button>
                            {exclusionesChanged && (
                                <button
                                    type="button"
                                    disabled={running}
                                    onClick={handlePreview}
                                    className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                    {running ? 'Calculando…' : 'Recalcular'}
                                </button>
                            )}
                            {!exclusionesChanged && preview!.turnosActualizados > 0 && (
                                <button
                                    type="button"
                                    onClick={handleApply}
                                    className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-2"
                                >
                                    <Zap size={16} />
                                    Aplicar como cambios pendientes
                                </button>
                            )}
                            {!exclusionesChanged && preview!.turnosActualizados === 0 && (
                                <button type="button" onClick={onClose}
                                    className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-slate-200 text-slate-600 hover:bg-slate-300">
                                    Cerrar
                                </button>
                            )}
                        </>
                    )}

                    {/* Estado resultado final */}
                    {result && (
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-200">
                            Cerrar
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
