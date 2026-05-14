'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, LayoutGrid, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { ServiceSLA } from '@/services/slaService';
import {
    analyzeShiftSchemesForService,
    type SchemeFit,
    type RotationSchemeId,
} from '@/lib/servicios/shiftSchemeAdvisor';

export interface ServiceShiftSchemeModalProps {
    open: boolean;
    onClose: () => void;
    service: (ServiceSLA & { id: string }) | null;
}

const fitTone: Record<SchemeFit, { bar: string; text: string; fill: string }> = {
    alta: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', fill: '#10b981' },
    media: { bar: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-200', fill: '#f59e0b' },
    baja: { bar: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', fill: '#94a3b8' },
};

function schemeBadge(id: RotationSchemeId): string {
    if (id === '6x2') return '6×2';
    if (id === '6x1') return '6×1';
    return '4×2';
}

function fitScore(fit: SchemeFit): number {
    if (fit === 'alta') return 100;
    if (fit === 'media') return 58;
    return 28;
}

type PanelId = 'resumen' | RotationSchemeId;

const SCHEME_CYCLE: Record<
    RotationSchemeId,
    { trabajo: number; franco: number; jornada: number; cicloDias: number }
> = {
    '6x2': { trabajo: 6, franco: 2, jornada: 8, cicloDias: 8 },
    '6x1': { trabajo: 6, franco: 1, jornada: 8, cicloDias: 7 },
    '4x2': { trabajo: 4, franco: 2, jornada: 12, cicloDias: 6 },
};

const CHART_AXIS = '#64748b';
const CHART_GRID = '#cbd5e1';

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-3">
            <p className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wide">{title}</p>
            {subtitle && <p className="text-[10px] font-bold text-slate-600 dark:text-slate-500 mt-0.5 mb-2">{subtitle}</p>}
            {!subtitle && <div className="h-1" />}
            <div className="w-full min-h-[200px]">{children}</div>
        </div>
    );
}

export function ServiceShiftSchemeModal({ open, onClose, service }: ServiceShiftSchemeModalProps) {
    const [panel, setPanel] = useState<PanelId>('resumen');

    const advice = useMemo(() => (service ? analyzeShiftSchemesForService(service) : null), [service]);

    useEffect(() => {
        if (open && service?.id) {
            setPanel('resumen');
        }
    }, [open, service?.id]);

    if (!open || !service || !advice) return null;

    const coverageLine = advice.coverageByDay.map((p, i) => ({ ...p, i }));
    const picoPromData = [
        { name: 'Pico', hs: advice.peakDailyCoverageHs },
        { name: 'Prom. L–V', hs: advice.avgWeekdayCoverageHs },
    ];
    const fitBars = advice.schemes.map((s) => ({
        id: s.id,
        name: schemeBadge(s.id),
        score: fitScore(s.fit),
        fit: s.fit,
    }));
    const cycleStackData = (['6x2', '6x1', '4x2'] as const).map((id) => ({
        id,
        name: schemeBadge(id),
        trabajo: SCHEME_CYCLE[id].trabajo,
        franco: SCHEME_CYCLE[id].franco,
    }));
    const jornadaData = (['6x2', '6x1', '4x2'] as const).map((id) => ({
        id,
        name: schemeBadge(id),
        h: SCHEME_CYCLE[id].jornada,
    }));
    const soldMonthly = advice.soldShiftAnalyses.map((row, i) => ({
        i,
        name:
            `${row.positionName.slice(0, 14)}${row.positionName.length > 14 ? '…' : ''} · ${row.blockLabel}`.slice(
                0,
                28,
            ),
        mes: row.indicativeMonthlyHsApprox,
    }));

    const tabs: { id: PanelId; label: string }[] = [
        { id: 'resumen', label: 'Resumen' },
        { id: '6x2', label: '6×2' },
        { id: '6x1', label: '6×1' },
        { id: '4x2', label: '4×2' },
    ];

    const selectedScheme = panel === 'resumen' ? null : panel;
    const schemeDetail = selectedScheme ? advice.schemes.find((s) => s.id === selectedScheme) : null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-black/50" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="shrink-0 flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/90 dark:bg-slate-900">
                    <div className="min-w-0 flex items-start gap-2">
                        <div className="p-2 rounded-xl bg-indigo-600 text-white shrink-0">
                            <LayoutGrid size={18} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-sm font-black text-indigo-950 dark:text-indigo-100 uppercase tracking-wide">
                                Turnos y esquema de rotación
                            </h2>
                            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">
                                {service.clientName || 'Cliente'} — {service.objectiveName || 'Objetivo'}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                                Contrato {service.startDate} → {service.endDate}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/80 dark:hover:bg-slate-800 text-slate-500 shrink-0">
                        <X size={18} />
                    </button>
                </div>

                <div className="shrink-0 flex flex-wrap gap-1.5 px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setPanel(t.id)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                                panel === t.id
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:border-indigo-300'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    <div className="p-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,1fr)]">
                        <div className="space-y-4 order-2 xl:order-1 text-[11px]">
                            {panel === 'resumen' && (
                                <>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <ChartCard
                                            title="Cobertura modelada (muestreo)"
                                            subtitle="Σ hs/día (puestos × bloques) a lo largo del período analizado."
                                        >
                                            {coverageLine.length > 0 ? (
                                                <ResponsiveContainer width="100%" height={220}>
                                                    <AreaChart data={coverageLine} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                        <defs>
                                                            <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} />
                                                        <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 9 }} interval="preserveStartEnd" />
                                                        <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} width={36} />
                                                        <Tooltip
                                                            contentStyle={{
                                                                borderRadius: 12,
                                                                fontSize: 12,
                                                                border: '1px solid #e2e8f0',
                                                            }}
                                                            formatter={(v: number) => [`${v} hs`, 'Cobertura']}
                                                            labelFormatter={(_, p) => (p?.[0]?.payload?.label ? `Día ${p[0].payload.label}` : '')}
                                                        />
                                                        <Area type="monotone" dataKey="hs" stroke="#4f46e5" strokeWidth={2} fill="url(#covGrad)" />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <p className="text-[11px] font-bold text-slate-400 py-8 text-center">Sin serie diaria.</p>
                                            )}
                                        </ChartCard>

                                        <ChartCard title="Pico vs laborables" subtitle="Comparación rápida de demanda diaria.">
                                            <ResponsiveContainer width="100%" height={220}>
                                                <BarChart data={picoPromData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} />
                                                    <XAxis dataKey="name" tick={{ fill: CHART_AXIS, fontSize: 10 }} />
                                                    <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} width={36} />
                                                    <Tooltip
                                                        contentStyle={{ borderRadius: 12, fontSize: 12 }}
                                                        formatter={(v: number) => [`${v} hs`, '']}
                                                    />
                                                    <Bar dataKey="hs" radius={[8, 8, 0, 0]} fill="#6366f1" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </ChartCard>
                                    </div>

                                    <ChartCard
                                        title="Encaje orientativo por rotación"
                                        subtitle="100 = encaje alto, valores medios/bajos según carga y tipo de puesto."
                                    >
                                        <ResponsiveContainer width="100%" height={240}>
                                            <BarChart data={fitBars} layout="vertical" margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} horizontal={false} />
                                                <XAxis type="number" domain={[0, 100]} tick={{ fill: CHART_AXIS, fontSize: 10 }} />
                                                <YAxis type="category" dataKey="name" width={44} tick={{ fill: CHART_AXIS, fontSize: 11 }} />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: 12, fontSize: 12 }}
                                                    formatter={(v: number, _n, props) => [`${v}`, props.payload.fit === 'alta' ? 'Encaje alto' : props.payload.fit === 'media' ? 'Encaje medio' : 'Encaje bajo']}
                                                />
                                                <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={22}>
                                                    {fitBars.map((e) => (
                                                        <Cell key={e.id} fill={fitTone[e.fit].fill} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </ChartCard>

                                    {soldMonthly.length > 0 && (
                                        <ChartCard
                                            title="Bloques no estándar — hs/mes orientativas"
                                            subtitle="Proyección desde el muestreo; referencias 8 h y 12 h CCT como guía."
                                        >
                                            <ResponsiveContainer width="100%" height={Math.max(200, soldMonthly.length * 36)}>
                                                <BarChart data={soldMonthly} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} horizontal={false} />
                                                    <XAxis type="number" tick={{ fill: CHART_AXIS, fontSize: 10 }} />
                                                    <YAxis type="category" dataKey="name" width={120} tick={{ fill: CHART_AXIS, fontSize: 9 }} />
                                                    <Tooltip
                                                        contentStyle={{ borderRadius: 12, fontSize: 12 }}
                                                        formatter={(v: number, name: string) =>
                                                            name === 'mes' ? [`${v} h/mes (aprox.)`, 'Carga mensual'] : [`${v} h`, 'Bloque']
                                                        }
                                                    />
                                                    <ReferenceLine x={160} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: '~160', fill: CHART_AXIS, fontSize: 10 }} />
                                                    <ReferenceLine x={240} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: '~240', fill: CHART_AXIS, fontSize: 10 }} />
                                                    <Bar dataKey="mes" radius={[0, 6, 6, 0]} fill="#f43f5e" barSize={18} name="mes" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </ChartCard>
                                    )}
                                </>
                            )}

                            {selectedScheme && schemeDetail && (
                                <>
                                    <ChartCard
                                        title={`Vista: ${schemeBadge(selectedScheme)}`}
                                        subtitle="Misma cobertura modelada; compará con el ciclo y la jornada típica del esquema elegido."
                                    >
                                        {coverageLine.length > 0 ? (
                                            <ResponsiveContainer width="100%" height={200}>
                                                <AreaChart data={coverageLine} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="covGrad2" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.28} />
                                                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} />
                                                    <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 9 }} interval="preserveStartEnd" />
                                                    <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} width={36} />
                                                    <Tooltip
                                                        contentStyle={{ borderRadius: 12, fontSize: 12 }}
                                                        formatter={(v: number) => [`${v} hs`, '']}
                                                    />
                                                    <Area type="monotone" dataKey="hs" stroke="#4f46e5" strokeWidth={2} fill="url(#covGrad2)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <p className="text-[11px] font-bold text-slate-400 py-6 text-center">Sin serie diaria.</p>
                                        )}
                                    </ChartCard>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <ChartCard title="Días por ciclo (trabajo / franco)" subtitle="Estructura típica del esquema.">
                                            <ResponsiveContainer width="100%" height={220}>
                                                <BarChart data={cycleStackData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} />
                                                    <XAxis dataKey="name" tick={{ fill: CHART_AXIS, fontSize: 10 }} />
                                                    <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} width={32} />
                                                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                                    <Bar dataKey="trabajo" stackId="c" fill="#6366f1" name="Trabajo" radius={[0, 0, 0, 0]} />
                                                    <Bar dataKey="franco" stackId="c" fill="#cbd5e1" name="Franco" radius={[6, 6, 0, 0]} />
                                                    <ReferenceLine
                                                        x={schemeBadge(selectedScheme)}
                                                        stroke="#4f46e5"
                                                        strokeWidth={2}
                                                        strokeDasharray="4 4"
                                                    />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </ChartCard>

                                        <ChartCard title="Jornada típica por turno (h)" subtitle="Marco 8 h vs 12 h según esquema.">
                                            <ResponsiveContainer width="100%" height={220}>
                                                <BarChart data={jornadaData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} />
                                                    <XAxis dataKey="name" tick={{ fill: CHART_AXIS, fontSize: 10 }} />
                                                    <YAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} width={28} domain={[0, 14]} />
                                                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${v} h`, '']} />
                                                    <ReferenceLine y={8} stroke="#10b981" strokeDasharray="4 4" label={{ value: '8 h', fill: '#059669', fontSize: 10 }} />
                                                    <ReferenceLine y={12} stroke="#0ea5e9" strokeDasharray="4 4" label={{ value: '12 h', fill: '#0284c7', fontSize: 10 }} />
                                                    <Bar dataKey="h" radius={[8, 8, 0, 0]} barSize={32}>
                                                        {jornadaData.map((e) => (
                                                            <Cell
                                                                key={e.id}
                                                                fill={e.id === selectedScheme ? '#4f46e5' : e.h >= 12 ? '#0ea5e9' : '#94a3b8'}
                                                                fillOpacity={e.id === selectedScheme ? 1 : 0.55}
                                                            />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </ChartCard>
                                    </div>

                                    <ChartCard title="Comparar encaje entre los tres" subtitle="El esquema activo en la pestaña aparece resaltado.">
                                        <ResponsiveContainer width="100%" height={200}>
                                            <BarChart data={fitBars} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} opacity={0.6} />
                                                <XAxis dataKey="name" tick={{ fill: CHART_AXIS, fontSize: 10 }} />
                                                <YAxis domain={[0, 100]} tick={{ fill: CHART_AXIS, fontSize: 10 }} width={32} />
                                                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                                                <Bar dataKey="score" radius={[8, 8, 0, 0]} barSize={40}>
                                                    {fitBars.map((e) => (
                                                        <Cell
                                                            key={e.id}
                                                            fill={fitTone[e.fit].fill}
                                                            fillOpacity={e.id === selectedScheme ? 1 : 0.35}
                                                            stroke={e.id === selectedScheme ? '#312e81' : 'none'}
                                                            strokeWidth={e.id === selectedScheme ? 2 : 0}
                                                        />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </ChartCard>
                                </>
                            )}
                        </div>

                        <div className="space-y-4 order-1 xl:order-2 text-[11px] min-w-0">
                            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2.5">
                                <p className="text-[9px] font-black uppercase text-indigo-600 dark:text-indigo-300 mb-1">Sugerencia principal</p>
                                <p className="text-lg font-black text-indigo-800 dark:text-indigo-100">{schemeBadge(advice.primaryScheme)}</p>
                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-1 leading-snug">{advice.primaryReason}</p>
                            </div>

                            {schemeDetail && (
                                <div
                                    className={`rounded-xl border px-3 py-2.5 ${
                                        advice.primaryScheme === schemeDetail.id
                                            ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/30'
                                            : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-black text-slate-800 dark:text-slate-100">{schemeBadge(schemeDetail.id)}</span>
                                        <span className={`text-[9px] font-black uppercase ${fitTone[schemeDetail.fit].text}`}>
                                            {schemeDetail.fit === 'alta' ? 'Encaje' : schemeDetail.fit === 'media' ? 'Posible' : 'Menos natural'}
                                        </span>
                                        {advice.primaryScheme === schemeDetail.id && (
                                            <CheckCircle2 size={14} className="text-indigo-600 shrink-0" aria-hidden />
                                        )}
                                    </div>
                                    <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 mt-1 leading-snug">{schemeDetail.note}</p>
                                    <p className="text-[9px] font-bold text-slate-500 mt-2 tabular-nums">
                                        Ciclo {SCHEME_CYCLE[schemeDetail.id].cicloDias} d · {SCHEME_CYCLE[schemeDetail.id].trabajo} trabajo /{' '}
                                        {SCHEME_CYCLE[schemeDetail.id].franco} franco · jornada típ. {SCHEME_CYCLE[schemeDetail.id].jornada} h
                                    </p>
                                </div>
                            )}

                            <div>
                                <p className="text-[9px] font-black uppercase text-slate-500 mb-1.5">Puestos declarados</p>
                                <ul className="space-y-1 font-bold text-slate-700 dark:text-slate-200">
                                    {advice.positionSummaries.length === 0 ? (
                                        <li className="text-slate-400">—</li>
                                    ) : (
                                        advice.positionSummaries.map((line, i) => (
                                            <li key={i} className="flex gap-2">
                                                <span className="text-indigo-500 shrink-0">·</span>
                                                <span>{line}</span>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5">
                                    <p className="text-[9px] font-black uppercase text-slate-500">Pico hs/día</p>
                                    <p className="text-base font-black tabular-nums text-slate-800 dark:text-white">{advice.peakDailyCoverageHs} hs</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5">
                                    <p className="text-[9px] font-black uppercase text-slate-500">Prom. L–V</p>
                                    <p className="text-base font-black tabular-nums text-slate-800 dark:text-white">{advice.avgWeekdayCoverageHs} hs</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 col-span-2">
                                    <p className="text-[9px] font-black uppercase text-slate-500">Pax en paralelo (pico)</p>
                                    <p className="text-base font-black tabular-nums text-slate-800 dark:text-white">{advice.peakConcurrentPax}</p>
                                </div>
                            </div>

                            {advice.issues.length > 0 && (
                                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                                    <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-black text-[10px] uppercase mb-1">
                                        <AlertTriangle size={14} /> Compatibilidad
                                    </div>
                                    <ul className="list-disc list-inside space-y-1 font-bold text-amber-900 dark:text-amber-100 text-[10px]">
                                        {advice.issues.map((t, i) => (
                                            <li key={i}>{t}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {advice.soldShiftAnalyses.length > 0 && (
                                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/25 px-3 py-2">
                                    <p className="text-[9px] font-black uppercase text-rose-800 dark:text-rose-200 mb-1.5">
                                        Lo vendido vs conviene (CCT 8 h / 12 h)
                                    </p>
                                    <p className="text-[10px] font-bold text-rose-950 dark:text-rose-100 mb-2 leading-snug">
                                        Estos bloques <strong>no</strong> son 8 h ni 12 h: suben la carga mensual y complican encadenar descansos. La
                                        proyección ~mes es orientativa (escala desde el tramo muestreado del contrato).
                                    </p>
                                    <ul className="space-y-2">
                                        {advice.soldShiftAnalyses.map((row, i) => (
                                            <li
                                                key={i}
                                                className="rounded-lg bg-white/80 dark:bg-slate-900/50 border border-rose-100 dark:border-rose-900/50 px-2 py-1.5"
                                            >
                                                <p className="text-[10px] font-black text-slate-800 dark:text-slate-100">
                                                    {row.positionName} · {row.blockLabel}{' '}
                                                    <span className="tabular-nums text-rose-700 dark:text-rose-300">({row.hours} h)</span>
                                                    {row.indicativeMonthlyHsApprox > 0 && (
                                                        <span className="text-[9px] font-bold text-slate-500 ml-1">
                                                            ≈ {row.indicativeMonthlyHsApprox} h/mes puesto
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-[9px] font-bold text-slate-700 dark:text-slate-300 mt-0.5 leading-snug">{row.verdict}</p>
                                                <p className="text-[9px] font-black text-indigo-700 dark:text-indigo-300 mt-0.5 leading-snug">
                                                    Cómo tratarlo: {row.treatment}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {advice.soldShiftAnalyses.length === 0 &&
                                (service.positions || []).some((p) => p.coverageType === 'custom' && (p.allowedShiftTypes || []).length > 0) && (
                                    <p className="text-[10px] font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-50/80 dark:bg-emerald-950/30 rounded-lg px-2 py-1.5 border border-emerald-200 dark:border-emerald-800">
                                        Bloques custom revisados: las hs declaradas encajan en marcos típicos <strong>8 h</strong> o <strong>12 h</strong>{' '}
                                        (o son jornadas cortas bajo 8 h sin alerta).
                                    </p>
                                )}

                            {panel === 'resumen' && (
                                <div>
                                    <p className="text-[9px] font-black uppercase text-slate-500 mb-1.5">Los tres esquemas</p>
                                    <div className="space-y-2">
                                        {advice.schemes.map((s) => {
                                            const t = fitTone[s.fit];
                                            return (
                                                <button
                                                    type="button"
                                                    key={s.id}
                                                    onClick={() => setPanel(s.id)}
                                                    className={`w-full text-left rounded-lg border px-2.5 py-2 flex gap-2 transition-colors ${
                                                        advice.primaryScheme === s.id
                                                            ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-indigo-400'
                                                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                                    }`}
                                                >
                                                    <div className={`w-1 rounded-full shrink-0 ${t.bar}`} />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="font-black text-slate-800 dark:text-slate-100">{schemeBadge(s.id)}</span>
                                                            <span className={`text-[9px] font-black uppercase ${t.text}`}>
                                                                {s.fit === 'alta' ? 'Encaje' : s.fit === 'media' ? 'Posible' : 'Menos natural'}
                                                            </span>
                                                            {advice.primaryScheme === s.id && (
                                                                <CheckCircle2 size={12} className="text-indigo-600 shrink-0" aria-hidden />
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">{s.note}</p>
                                                        <p className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 mt-1">Ver gráficos →</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <p className="text-[9px] font-bold text-slate-500 leading-snug">
                                La planificación fina (descansos legales, solapes horarios entre bloques custom y asignación por guardia) sigue en{' '}
                                <strong>Planificación</strong>. Esto orienta sólo el <strong>marco de rotación</strong> frente a la SLA modelada.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
