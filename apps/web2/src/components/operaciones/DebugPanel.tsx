/**
 * DebugPanel — Panel de diagnóstico para operaciones.
 * Muestra por objetivo y puesto:
 *   • Turnos cargados (raw + clasificados)
 *   • Por qué se generó o NO una vacante virtual
 *   • Posiciones SLA configuradas y su cobertura actual
 *
 * Uso: activar con ?debug=1 en la URL, o con el botón "🔍 Debug" en el header.
 */

import React, { useMemo, useState } from 'react';
import { X, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Clock, UserX } from 'lucide-react';

interface DebugPanelProps {
    processedData: any[];
    servicesSLA: any[];
    publishStatusMap: Record<string, boolean>;
    rawShifts?: any[];
    onClose: () => void;
}

const normPos = (n: unknown) => {
    let s = String(n ?? '').trim().toLowerCase();
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/^puesto\s+/, '');
    return s;
};

const fmtTime = (d: Date | null | undefined) => {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '??:??';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const STATUS_COLORS: Record<string, string> = {
    active:   'bg-green-100 text-green-800',
    absent:   'bg-red-100 text-red-800',
    potential:'bg-orange-100 text-orange-800',
    future:   'bg-blue-100 text-blue-700',
    imminent: 'bg-yellow-100 text-yellow-800',
    vacant:   'bg-rose-200 text-rose-900',
    retained: 'bg-purple-100 text-purple-800',
    completed:'bg-slate-100 text-slate-500',
    unknown:  'bg-gray-100 text-gray-500',
};

function getStatus(s: any): string {
    if (s.isCompleted)         return 'completed';
    if (s.isRetention)         return 'retained';
    if (s.isAbsent)            return 'absent';
    if (s.isPotentialAbsence)  return 'potential';
    if (s.isUnassigned)        return 'vacant';
    if (s.isPresent)           return 'active';
    if (s.isImminent)          return 'imminent';
    if (s.isFuture)            return 'future';
    return 'unknown';
}

const STATUS_LABEL: Record<string, string> = {
    active:   'PRESENTE',
    absent:   'AUSENTE',
    potential:'POSIBLE AUSENCIA',
    future:   'PLANIFICADO',
    imminent: 'INMIENTE',
    vacant:   'VACANTE',
    retained: 'RETENIDO',
    completed:'COMPLETADO',
    unknown:  'DESCONOCIDO',
};

export const DebugPanel: React.FC<DebugPanelProps> = ({
    processedData, servicesSLA, publishStatusMap, rawShifts = [], onClose
}) => {
    const [expandedObj, setExpandedObj] = useState<string | null>(null);
    const [filterObj, setFilterObj] = useState('');

    const now = new Date();

    // Agrupar processedData por objetivo
    const byObjective = useMemo(() => {
        const map = new Map<string, { name: string; clientName: string; shifts: any[] }>();
        processedData.forEach(s => {
            const key = s.objectiveId || 'unknown';
            if (!map.has(key)) map.set(key, { name: s.objectiveName || key, clientName: s.clientName || '', shifts: [] });
            map.get(key)!.shifts.push(s);
        });
        return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [processedData]);

    // Análisis SLA por objetivo
    const slaAnalysis = useMemo(() => {
        const result: Record<string, any[]> = {};
        const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
        const isTodayShift = (s: any) => {
            if (!s.shiftDateObj) return false;
            return s.shiftDateObj.toLocaleDateString('en-CA') === todayStr;
        };
        servicesSLA.forEach(sla => {
            if (!sla.positions) return;
            const objShifts = processedData.filter((s: any) => s.objectiveId === sla.objectiveId);
            result[sla.objectiveId] = sla.positions.map((pos: any) => {
                const targetPosName = normPos(pos.name);
                const allPosShifts = objShifts.filter((s: any) => normPos(s.positionName) === targetPosName);
                // Cubierto HOY: solo turnos del día de hoy que cuentan para cobertura
                const todayPosShifts = allPosShifts.filter((s: any) => isTodayShift(s));
                const activePosShifts = todayPosShifts.filter((s: any) => s.countsForCoverage);
                const absentShifts = todayPosShifts.filter((s: any) => s.isAbsent || s.isPotentialAbsence);
                const vacantShifts = todayPosShifts.filter((s: any) => s.isUnassigned);
                const required = pos.quantity || 1;
                const covered = activePosShifts.length;
                const deficit = Math.max(0, required - covered);

                const dayCode = ['D','L','M','X','J','V','S'][now.getDay()];
                const activeDaysOk = !pos.activeDays?.length || pos.activeDays.includes(dayCode);

                return {
                    posName: pos.name,
                    targetPosName,
                    required,
                    covered,
                    deficit,
                    allCount: allPosShifts.length,
                    absentCount: absentShifts.length,
                    vacantCount: vacantShifts.length,
                    activeDays: pos.activeDays || [],
                    activeDaysOk,
                    allowedShiftTypes: pos.allowedShiftTypes || [],
                    slotDays: (pos.allowedShiftTypes || []).flatMap((s: any) => s.days || []).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i),
                    shifts: allPosShifts,
                };
            });
        });
        return result;
    }, [processedData, servicesSLA, now]);

    // Turnos raw descartados (rawShifts que no están en processedData)
    const rawIds = useMemo(() => new Set(processedData.map((s: any) => s.id)), [processedData]);
    const discardedRaw = useMemo(() =>
        rawShifts.filter(s => !rawIds.has(s.id)),
    [rawShifts, rawIds]);

    const filtered = filterObj
        ? byObjective.filter(o => o.name.toLowerCase().includes(filterObj.toLowerCase()) || o.id.toLowerCase().includes(filterObj.toLowerCase()))
        : byObjective;

    return (
        <div className="fixed inset-0 z-[2000] bg-black/60 flex items-start justify-center pt-4 px-2 overflow-auto">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl border border-slate-200 flex flex-col max-h-[95vh]">
                {/* Header */}
                <div className="bg-slate-900 rounded-t-xl px-4 py-3 flex items-center gap-3 shrink-0">
                    <AlertTriangle size={16} className="text-amber-400" />
                    <span className="text-white font-bold text-sm flex-1">🔍 Panel de Diagnóstico — Operaciones</span>
                    <span className="text-slate-400 text-xs">{processedData.length} turnos procesados · {rawShifts.length} raw</span>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Stats rápidas */}
                <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-3 text-xs shrink-0">
                    {[
                        { label: 'Presentes', val: processedData.filter((s:any)=>s.isPresent&&!s.isCompleted).length, cls:'text-green-700 font-bold' },
                        { label: 'Ausentes', val: processedData.filter((s:any)=>s.isAbsent).length, cls:'text-red-700 font-bold' },
                        { label: 'Posibles ausencias', val: processedData.filter((s:any)=>s.isPotentialAbsence).length, cls:'text-orange-700 font-bold' },
                        { label: 'Vacantes', val: processedData.filter((s:any)=>s.isUnassigned).length, cls:'text-rose-700 font-bold' },
                        { label: 'Planificados', val: processedData.filter((s:any)=>s.isFuture).length, cls:'text-blue-700 font-bold' },
                        { label: 'Descartados (raw)', val: discardedRaw.length, cls:'text-slate-500' },
                    ].map(({ label, val, cls }) => (
                        <span key={label} className="bg-slate-50 border border-slate-200 rounded px-2 py-1">
                            {label}: <span className={cls}>{val}</span>
                        </span>
                    ))}
                </div>

                {/* Filtro */}
                <div className="px-4 py-2 border-b border-slate-100 shrink-0">
                    <input
                        className="w-full border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Filtrar por objetivo..."
                        value={filterObj}
                        onChange={e => setFilterObj(e.target.value)}
                    />
                </div>

                {/* Lista de objetivos */}
                <div className="overflow-y-auto flex-1 p-4 space-y-2">
                    {/* DESCARTADOS */}
                    {discardedRaw.length > 0 && (
                        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                            <div
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={() => setExpandedObj(expandedObj === '__discarded' ? null : '__discarded')}
                            >
                                {expandedObj === '__discarded' ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                <AlertTriangle size={14} className="text-amber-600" />
                                <span className="text-amber-800 font-bold text-sm">
                                    ⚠️ Turnos RAW descartados ({discardedRaw.length}) — no aparecen en la UI
                                </span>
                            </div>
                            {expandedObj === '__discarded' && (
                                <div className="mt-3 overflow-x-auto">
                                    <table className="text-xs w-full border-collapse">
                                        <thead>
                                            <tr className="bg-amber-100 text-amber-900">
                                                <th className="px-2 py-1 text-left border border-amber-200">ID</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">Empleado</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">Objetivo</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">Puesto</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">isAbsent</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">isPresent</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">origin</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">status</th>
                                                <th className="px-2 py-1 text-left border border-amber-200">Razón descarte</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {discardedRaw.map((s: any) => {
                                                const rawPos2 = (s.positionName || '').trim();
                                                const noPos = !rawPos2 || rawPos2 === 'Sin Puesto' || rawPos2 === 'General';
                                                const noPubKey = `${s.objectiveId}_${s.shiftDateObj?.getFullYear?.() ?? 0}_${(s.shiftDateObj?.getMonth?.() ?? -1) + 1}`;
                                                const notPublished = !publishStatusMap[noPubKey];
                                                const isOpOrigin = s.origin === 'RETEN' || s.origin === 'OPERATIONS_COVERAGE' || s.origin === 'SLA_VIRTUAL' || !!s.isReten;
                                                const isProcessed = s.isPresent || s.status === 'PRESENT' || s.status === 'COMPLETED' || s.isReportedToPlanning || s.isReported || s.isAbsent;
                                                let reason = '?';
                                                if (noPos) reason = `positionName vacío/inválido: "${rawPos2}"`;
                                                else if (!isOpOrigin && !isProcessed && notPublished) reason = `Planificación NO publicada (key: ${noPubKey})`;
                                                else if (s.draft) reason = 'Es borrador (draft=true)';
                                                else if (s.status === 'COVERED' && !s.isAbsent) reason = 'COVERED sin isAbsent';
                                                return (
                                                    <tr key={s.id} className="border-b border-amber-100 hover:bg-amber-50">
                                                        <td className="px-2 py-1 border border-amber-100 font-mono text-[10px] max-w-[80px] truncate">{s.id}</td>
                                                        <td className="px-2 py-1 border border-amber-100">{s.employeeName || '—'}</td>
                                                        <td className="px-2 py-1 border border-amber-100">{s.objectiveName || s.objectiveId}</td>
                                                        <td className="px-2 py-1 border border-amber-100 font-medium">{s.positionName || <span className="text-red-600">VACÍO</span>}</td>
                                                        <td className="px-2 py-1 border border-amber-100">{s.isAbsent ? '✅' : '—'}</td>
                                                        <td className="px-2 py-1 border border-amber-100">{s.isPresent ? '✅' : '—'}</td>
                                                        <td className="px-2 py-1 border border-amber-100">{s.origin || '—'}</td>
                                                        <td className="px-2 py-1 border border-amber-100">{s.status || '—'}</td>
                                                        <td className="px-2 py-1 border border-amber-100 text-red-700 font-medium">{reason}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* OBJETIVOS */}
                    {filtered.map(obj => {
                        const isOpen = expandedObj === obj.id;
                        const slaPos = slaAnalysis[obj.id] || [];
                        const hasIssues = slaPos.some(p => p.deficit > 0 || p.absentCount > 0);
                        const pubKey2 = `${obj.id}_${now.getFullYear()}_${now.getMonth() + 1}`;
                        const isPublished = !!publishStatusMap[pubKey2];

                        return (
                            <div key={obj.id} className={`border rounded-lg overflow-hidden ${hasIssues ? 'border-red-200' : 'border-slate-200'}`}>
                                <div
                                    className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer ${hasIssues ? 'bg-red-50' : 'bg-slate-50'} hover:bg-slate-100`}
                                    onClick={() => setExpandedObj(isOpen ? null : obj.id)}
                                >
                                    {isOpen ? <ChevronDown size={14} className="shrink-0"/> : <ChevronRight size={14} className="shrink-0"/>}
                                    <div className="flex-1 min-w-0">
                                        <span className="font-semibold text-sm text-slate-800">{obj.name}</span>
                                        <span className="text-slate-400 text-xs ml-2">{obj.clientName}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs shrink-0">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {isPublished ? '✓ Publicado' : '⚠ Sin publicar'}
                                        </span>
                                        <span className="text-slate-500">{obj.shifts.length} turnos</span>
                                        {slaPos.some(p => p.deficit > 0) && (
                                            <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">
                                                {slaPos.reduce((a, p) => a + p.deficit, 0)} vacante(s)
                                            </span>
                                        )}
                                        {slaPos.some(p => p.absentCount > 0) && (
                                            <span className="bg-orange-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">
                                                {slaPos.reduce((a, p) => a + p.absentCount, 0)} ausente(s)
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {isOpen && (
                                    <div className="p-3 space-y-4 border-t border-slate-100">
                                        {/* SLA positions */}
                                        {slaPos.length > 0 && (
                                            <div>
                                                <div className="text-xs font-bold text-slate-500 uppercase mb-2">Puestos SLA</div>
                                                <div className="space-y-1.5">
                                                    {slaPos.map((pos, i) => (
                                                        <div key={i} className={`rounded p-2 text-xs ${pos.deficit > 0 ? 'bg-red-50 border border-red-200' : pos.absentCount > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {pos.deficit > 0
                                                                    ? <AlertTriangle size={12} className="text-red-600 shrink-0"/>
                                                                    : <CheckCircle2 size={12} className="text-green-600 shrink-0"/>
                                                                }
                                                                <span className="font-bold">{pos.posName}</span>
                                                                <span className="text-slate-400">→ norm: <code className="bg-slate-200 px-1 rounded">{pos.targetPosName}</code></span>
                                                                <span>Requerido: <b>{pos.required}</b></span>
                                                                <span className="text-green-700">Cubierto: <b>{pos.covered}</b></span>
                                                                {pos.absentCount > 0 && <span className="text-red-700">Ausentes: <b>{pos.absentCount}</b></span>}
                                                                {pos.deficit > 0 && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded font-bold">DÉFICIT: {pos.deficit}</span>}
                                                                {(() => {
                                                                    const dayCode = ['D','L','M','X','J','V','S'][(new Date()).getDay()];
                                                                    const displayDays = pos.slotDays?.length > 0 ? pos.slotDays : pos.activeDays;
                                                                    const ok = displayDays.length === 0 || displayDays.includes(dayCode);
                                                                    if (displayDays.length === 0) return null;
                                                                    return (
                                                                        <span className={ok ? 'text-green-700' : 'text-orange-700 font-bold'}>
                                                                            Días: [{displayDays.join(',')}] {ok ? '✓ hoy OK' : '✗ no opera hoy'}
                                                                        </span>
                                                                    );
                                                                })()}
                                                                {pos.allowedShiftTypes.length > 0 && (
                                                                    <span className="text-slate-400">Turnos SLA: {pos.allowedShiftTypes.length}</span>
                                                                )}
                                                                {pos.allCount === 0 && (
                                                                    <span className="text-red-800 font-bold">⚠ NINGÚN turno con positionName matching</span>
                                                                )}
                                                            </div>
                                                            {/* Turnos del puesto */}
                                                            {pos.shifts.length > 0 && (
                                                                <div className="mt-1.5 flex flex-wrap gap-1">
                                                                    {pos.shifts.map((s: any, j: number) => {
                                                                        const st = getStatus(s);
                                                                        const dateLabel = s.shiftDateObj instanceof Date && !isNaN(s.shiftDateObj.getTime())
                                                                            ? `${s.shiftDateObj.getDate()}/${s.shiftDateObj.getMonth()+1}`
                                                                            : '?';
                                                                        return (
                                                                            <span key={j} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[st]}`}>
                                                                                {s.employeeName?.replace('VACANTE: ','VAC: ')}
                                                                                <span className="opacity-50 font-mono">{dateLabel}</span>
                                                                                <span className="opacity-60">{fmtTime(s.shiftDateObj)}-{fmtTime(s.endDateObj)}</span>
                                                                                <span className="font-bold">[{STATUS_LABEL[st]}]</span>
                                                                                {!s.countsForCoverage && st !== 'vacant' && <span className="bg-black/20 px-0.5 rounded">¬cov</span>}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Turnos procesados */}
                                        <div>
                                            <div className="text-xs font-bold text-slate-500 uppercase mb-2">Turnos procesados ({obj.shifts.length})</div>
                                            <div className="overflow-x-auto">
                                                <table className="text-xs w-full border-collapse">
                                                    <thead>
                                                        <tr className="bg-slate-100 text-slate-600">
                                                            <th className="px-2 py-1 text-left border border-slate-200">Empleado</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">Puesto</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">Fecha</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">Horario</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">Estado</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">countsForCov</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">origin</th>
                                                            <th className="px-2 py-1 text-left border border-slate-200">Virtual</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {obj.shifts.map((s: any, j: number) => {
                                                            const st = getStatus(s);
                                                            return (
                                                                <tr key={j} className="border-b border-slate-100 hover:bg-slate-50">
                                                                    <td className="px-2 py-1 border border-slate-100 font-medium">{s.employeeName || '—'}</td>
                                                                    <td className="px-2 py-1 border border-slate-100">{s.positionName || <span className="text-red-600 font-bold">VACÍO</span>}</td>
                                                                    <td className="px-2 py-1 border border-slate-100 font-mono text-slate-500">{s.shiftDateObj instanceof Date ? `${s.shiftDateObj.getDate()}/${s.shiftDateObj.getMonth()+1}` : '?'}</td>
                                                                    <td className="px-2 py-1 border border-slate-100 font-mono">{fmtTime(s.shiftDateObj)}–{fmtTime(s.endDateObj)}</td>
                                                                    <td className="px-2 py-1 border border-slate-100">
                                                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_COLORS[st]}`}>{STATUS_LABEL[st]}</span>
                                                                    </td>
                                                                    <td className="px-2 py-1 border border-slate-100 text-center">{s.isVirtual ? <span className="text-amber-600 font-bold">✓ virtual</span> : '—'}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
