import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, BarChart2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

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
}

interface EquilibrarOutput {
    ok: boolean;
    empleadosRotados: number;
    bloquesProcesados: number;
    turnosActualizados: number;
    horasAntes: Record<string, number>;
    horasDespues: Record<string, number>;
    errores: string[];
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export default function EquilibrarCronoModal({ open, onClose, empresaId, objectiveId, objectiveNombre, year, month, employees }: Props) {
    const [running, setRunning]   = useState(false);
    const [result, setResult]     = useState<EquilibrarOutput | null>(null);

    const empMap: Record<string, string> = {};
    employees.forEach(e => { empMap[e.id] = e.name || e.nombre || e.id; });

    const handleRun = async () => {
        setRunning(true);
        setResult(null);
        try {
            const fn = httpsCallable<object, EquilibrarOutput>(functions, 'runEquilibrarCrono');
            const res = await fn({ empresaId, objectiveId, year, month });
            setResult(res.data);
            if (res.data.ok && res.data.turnosActualizados > 0) {
                toast.success(`${res.data.empleadosRotados} empleados rotados · ${res.data.turnosActualizados} turnos actualizados`);
            } else if (res.data.errores?.length) {
                toast.info(res.data.errores[0]);
            }
        } catch (e: any) {
            toast.error(e?.message || 'Error al equilibrar.');
        } finally {
            setRunning(false);
        }
    };

    if (!open || typeof document === 'undefined') return null;

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
                    {!result && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                            <p className="font-black text-slate-700 mb-1">¿Qué hace?</p>
                            <ul className="space-y-0.5 list-disc list-inside">
                                <li>Detecta los bloques de trabajo (rachas de 6 días) de cada empleado.</li>
                                <li>Por cada bloque, rota quién cubre qué posición: el de menos horas acumuladas toma la posición más pesada (EN, RO).</li>
                                <li>Puede cambiar de banda (M → N) entre bloques — el franco garantiza el descanso.</li>
                                <li>Nadie supera las 200h CCT por ciclo.</li>
                            </ul>
                        </div>
                    )}

                    {/* Resultado */}
                    {result && (
                        <div className="space-y-3">
                            {(() => {
                                const noData = !result.ok && result.errores?.[0]?.includes('No se encontraron turnos');
                                return (
                                <div className={`rounded-xl border-2 px-3 py-2.5 ${result.ok && result.turnosActualizados > 0 ? 'border-emerald-300 bg-emerald-50' : noData ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckCircle2 size={16} className={result.ok ? 'text-emerald-600' : noData ? 'text-amber-500' : 'text-slate-400'} />
                                        <span className="font-black text-sm text-slate-800">
                                            {result.turnosActualizados > 0
                                                ? `${result.turnosActualizados} turnos actualizados · ${result.empleadosRotados} empleados rotados`
                                                : noData ? 'El cronograma no está guardado aún'
                                                : result.errores?.[0] || 'Sin cambios necesarios'}
                                        </span>
                                    </div>
                                    {noData ? (
                                        <>
                                            <p className="text-[11px] text-amber-700 font-medium">Guardá el borrador del crono (botón <strong>Guardar</strong>) y luego volvé a equilibrar.</p>
                                            <p className="text-[10px] text-amber-600/70 mt-0.5 font-mono">{result.errores?.[0]}</p>
                                        </>
                                    ) : (
                                        <p className="text-[10px] text-slate-500">{result.bloquesProcesados} bloques procesados</p>
                                    )}
                                </div>
                                );
                            })()}

                            {/* Tabla antes/después */}
                            {result.turnosActualizados > 0 && (() => {
                                const empIds = Object.keys(result.horasAntes).sort((a, b) =>
                                    (result.horasDespues[b] || 0) - (result.horasDespues[a] || 0));
                                return (
                                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-slate-50 text-slate-600">
                                                <tr>
                                                    <th className="text-left px-3 py-1.5 font-black uppercase">Empleado</th>
                                                    <th className="text-right px-3 py-1.5 font-black uppercase">Antes</th>
                                                    <th className="text-right px-3 py-1.5 font-black uppercase">Después</th>
                                                    <th className="text-right px-3 py-1.5 font-black uppercase">Δ</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {empIds.map(id => {
                                                    const antes   = Math.round(result.horasAntes[id] || 0);
                                                    const despues = Math.round(result.horasDespues[id] || 0);
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

                            {result.errores?.length > 0 && (
                                <p className="text-[10px] text-amber-700 font-bold">{result.errores.join(' · ')}</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-slate-50 flex gap-2">
                    <button type="button" onClick={onClose} disabled={running}
                        className="flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase text-slate-600 hover:bg-slate-200">
                        {result ? 'Cerrar' : 'Cancelar'}
                    </button>
                    {!result && (
                        <button
                            type="button"
                            disabled={running}
                            onClick={handleRun}
                            className="flex-[2] px-4 py-3 rounded-xl text-xs font-black uppercase bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center gap-2"
                        >
                            {running ? <Loader2 size={16} className="animate-spin" /> : <BarChart2 size={16} />}
                            {running ? 'Equilibrando…' : 'Equilibrar horas'}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
