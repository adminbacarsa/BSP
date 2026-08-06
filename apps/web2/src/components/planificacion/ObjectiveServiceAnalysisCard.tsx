import React from 'react';
import { Layers, Clock, LayoutGrid, Coffee } from 'lucide-react';
import type { ObjectiveServiceAnalysis } from '@/lib/planificacion/objectiveServiceModel';

export type ObjectiveServiceAnalysisCardProps = {
    analysis: ObjectiveServiceAnalysis;
    compact?: boolean;
    className?: string;
};

const KIND_BADGE: Record<string, string> = {
    '24hs_only': 'bg-violet-100 text-violet-900 border-violet-200',
    custom_only: 'bg-cyan-100 text-cyan-900 border-cyan-200',
    mixed: 'bg-amber-100 text-amber-900 border-amber-200',
    empty: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function ObjectiveServiceAnalysisCard({
    analysis,
    compact = false,
    className = '',
}: ObjectiveServiceAnalysisCardProps) {
    const badge = KIND_BADGE[analysis.kind] ?? KIND_BADGE.empty;

    return (
        <div className={`rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white shadow-sm ${className}`}>
            <div className="px-3 py-2.5 border-b border-indigo-100/80 flex items-start gap-2">
                <div className="p-1.5 rounded-xl bg-indigo-600 text-white shrink-0">
                    <Layers size={14} />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">
                        Análisis del servicio (SLA)
                    </p>
                    <p className="text-[11px] font-black text-slate-800 leading-snug mt-0.5">
                        {analysis.cronogramTypeLabel}
                    </p>
                    <span className={`inline-block mt-1 text-[9px] font-bold px-2 py-0.5 rounded-lg border ${badge}`}>
                        {analysis.kind === '24hs_only' && 'Puro 24 HS'}
                        {analysis.kind === 'custom_only' && 'Puro custom'}
                        {analysis.kind === 'mixed' && 'Mixto 24 HS + custom'}
                        {analysis.kind === 'empty' && 'Sin estructura'}
                    </span>
                </div>
            </div>

            <div className={`px-3 py-2.5 space-y-2 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-white border border-slate-100 px-2 py-1.5 text-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase">Puestos</p>
                        <p className="font-black text-slate-800">{analysis.positionCounts.total}</p>
                    </div>
                    <div className="rounded-xl bg-white border border-violet-100 px-2 py-1.5 text-center">
                        <p className="text-[8px] font-black text-violet-500 uppercase">24 HS</p>
                        <p className="font-black text-violet-900">{analysis.positionCounts.rotation24hs}</p>
                    </div>
                    <div className="rounded-xl bg-white border border-cyan-100 px-2 py-1.5 text-center">
                        <p className="text-[8px] font-black text-cyan-600 uppercase">Custom</p>
                        <p className="font-black text-cyan-900">{analysis.positionCounts.custom}</p>
                    </div>
                </div>

                {analysis.kind === 'mixed' && (
                    <p className="text-[10px] font-bold text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-2.5 py-1.5">
                        Mixto: {analysis.positionCounts.rotation24hs} puesto(s) rotación M/T/N ·{' '}
                        {analysis.positionCounts.custom} puesto(s) custom (horarios / cupos propios).
                    </p>
                )}

                <div className="flex flex-wrap gap-2 text-[10px] text-slate-600">
                    {analysis.peakConcurrent24hs > 0 && (
                        <span className="inline-flex items-center gap-1 font-bold">
                            <Clock size={11} className="text-violet-500" />
                            Pico 24 HS: {analysis.peakConcurrent24hs} pax
                        </span>
                    )}
                    {analysis.peakConcurrentCustom > 0 && (
                        <span className="inline-flex items-center gap-1 font-bold">
                            <LayoutGrid size={11} className="text-cyan-600" />
                            Pico custom: {analysis.peakConcurrentCustom} cupos/día
                        </span>
                    )}
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">
                        Plantilla estructural
                    </p>
                    {analysis.kind === 'mixed' && (
                        <p className="text-[9px] font-bold text-amber-800 mb-1 leading-snug">
                            Ciclos: {analysis.cycleBlocks.rotation24hs} (24 HS) · {analysis.cycleBlocks.custom}
                        </p>
                    )}
                    {analysis.kind !== 'mixed' && (
                        <p className="text-[9px] font-bold text-slate-500 mb-1">Ciclo {analysis.cycleKey}</p>
                    )}
                    {analysis.kind === 'mixed' ? (
                        <p className="font-bold text-slate-800 leading-snug">
                            {analysis.plantilla.rotation24hs} (24 HS) + {analysis.plantilla.customPool} (titulares custom)
                            {analysis.plantilla.other > 0 ? ` + ${analysis.plantilla.other}` : ''}
                            {' '}= {analysis.plantilla.total} guardias
                        </p>
                    ) : (
                        <p className="font-bold text-slate-800">{analysis.plantilla.total} guardias</p>
                    )}
                </div>

                <div className="rounded-xl bg-emerald-50/80 border border-emerald-100 px-2.5 py-2 space-y-1.5">
                    <p className="text-[8px] font-black text-emerald-700 uppercase flex items-center gap-1">
                        <Coffee size={11} />
                        Presupuesto de francos
                    </p>
                    {analysis.francoBudget.rotation24hs.totalPax > 0 && (
                        <p className="text-[10px] font-bold text-violet-900 leading-snug">
                            Rotación 24 HS:{' '}
                            <span className="text-violet-700">
                                {analysis.francoBudget.rotation24hs.francosSimultaneosRotacion} franco(s) simultáneo(s)
                            </span>
                            {' '}(1 por pax · {analysis.francoBudget.rotation24hs.totalPax} pax)
                        </p>
                    )}
                    <p className="text-[10px] font-bold text-slate-800 leading-snug">
                        Día pico (servicio {analysis.francoBudget.peakServicioDiaModo8}): pool operativo{' '}
                        <span className="text-emerald-800">
                            {analysis.francoBudget.poolFrancosDiaPico}
                        </span>
                        {' '}(plantilla {analysis.francoBudget.plantillaTotal} − cupos facturables)
                    </p>
                    {analysis.francoBudget.dayProfiles.length > 1 && (
                        <ul className="text-[9px] text-slate-600 space-y-0.5">
                            {analysis.francoBudget.dayProfiles.map((d) => (
                                <li key={d.dayLetter}>
                                    <span className="font-bold text-slate-700">{d.label}:</span>{' '}
                                    servicio {d.servicioModo8} · pool {d.poolOperativoDia}
                                    {d.francosRotacion24hs > 0 && (
                                        <span className="text-violet-700">
                                            {' '}
                                            · rotación {d.francosRotacion24hs} F
                                        </span>
                                    )}
                                    {d.customTitularesEnFrancoEstructural > 0 && (
                                        <span className="text-cyan-700">
                                            {' '}
                                            · custom {d.customTitularesEnFrancoEstructural} en F estructural
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {!compact && analysis.positions24hs.length > 0 && (
                    <div>
                        <p className="text-[8px] font-black text-violet-500 uppercase mb-1">Puestos 24 HS</p>
                        <ul className="space-y-1">
                            {analysis.positions24hs.map((p) => (
                                <li
                                    key={p.positionName}
                                    className="flex justify-between gap-2 text-[10px] font-bold text-slate-700 bg-white rounded-lg px-2 py-1 border border-violet-50"
                                >
                                    <span className="truncate">{p.positionName}</span>
                                    <span className="shrink-0 text-violet-700">
                                        {p.qty} pax · {p.structuralHeadcount} g.
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {!compact && analysis.positionsCustom.length > 0 && (
                    <div>
                        <p className="text-[8px] font-black text-cyan-600 uppercase mb-1">Puestos custom</p>
                        <ul className="space-y-1">
                            {analysis.positionsCustom.map((p) => (
                                <li
                                    key={p.positionName}
                                    className="flex justify-between gap-2 text-[10px] font-bold text-slate-700 bg-white rounded-lg px-2 py-1 border border-cyan-50"
                                >
                                    <span className="truncate">
                                        {p.positionName}
                                        <span className="font-normal text-slate-400 ml-1">{p.activeDaysLabel}</span>
                                    </span>
                                    <span className="shrink-0 text-cyan-800">
                                        {p.qty} pax · {p.structuralHeadcount} g.
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {analysis.summaryLines.length > 0 && (
                    <ul className="text-[10px] text-slate-600 space-y-1 list-disc pl-4">
                        {analysis.summaryLines.map((line, i) => (
                            <li key={i}>{line}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
