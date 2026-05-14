'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw, Sparkles, TrendingUp } from 'lucide-react';
import {
    defaultNominaComparisonScenarios,
    evaluateAdjustedNominaScenarios,
    formatARS,
    mergeDefaultServiceMarginVariables,
    type NominaScenarioColumnInput,
    WorkScheme,
} from '@/lib/servicios/serviceMarginOptimizer';

export interface ServiceMarginPerServiceModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    slaHours: number;
    /** Mes del carrusel KPI (texto corto). */
    kpiMonthLabel: string;
    /** Si el SLA vino del mes pico porque el mes listado no tenía horas. */
    slaNote?: string | null;
}

type ScenarioForm = NominaScenarioColumnInput;

const DEFAULT_SCENARIOS: ScenarioForm[] = defaultNominaComparisonScenarios();

function scenariosFromForm(rows: ScenarioForm[]): NominaScenarioColumnInput[] {
    return rows.map((r) => ({
        ...r,
        headcount: Math.max(0, Math.floor(Number(r.headcount) || 0)),
    }));
}

export function ServiceMarginPerServiceModal({
    open,
    onClose,
    title,
    subtitle,
    slaHours,
    kpiMonthLabel,
    slaNote,
}: ServiceMarginPerServiceModalProps) {
    const [scenarios, setScenarios] = useState<ScenarioForm[]>(DEFAULT_SCENARIOS);
    const [price, setPrice] = useState<number | ''>('');
    const [baseCost, setBaseCost] = useState<number | ''>('');

    useEffect(() => {
        if (open) setScenarios(DEFAULT_SCENARIOS.map((s) => ({ ...s })));
    }, [open, slaHours]);

    const evaluation = useMemo(() => {
        const v = mergeDefaultServiceMarginVariables({
            totalSlaHours: slaHours,
            ...(price !== '' ? { sellingPricePerHour: Number(price) } : {}),
            ...(baseCost !== '' ? { baseEmployeeCostMonthlyARS: Number(baseCost) } : {}),
        });
        return evaluateAdjustedNominaScenarios(slaHours, v, scenariosFromForm(scenarios));
    }, [slaHours, price, baseCost, scenarios]);

    if (!open) return null;

    const { columns, winnerLabel, winnerColumnId, alerts } = evaluation;
    const sla = Math.round(slaHours);
    const monthTitle = kpiMonthLabel || 'mes seleccionado';

    const updateScenario = (id: string, patch: Partial<ScenarioForm>) => {
        setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/90 dark:bg-slate-900 z-10">
                    <div className="min-w-0">
                        <h2 className="text-sm font-black text-indigo-950 dark:text-indigo-100 uppercase tracking-wide">
                            Comparativa de costos con nómina ajustada
                        </h2>
                        <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">{title}</p>
                        {subtitle && <p className="text-[10px] text-slate-500 font-bold mt-0.5">{subtitle}</p>}
                        <p className="text-[10px] font-black text-indigo-800 dark:text-indigo-200 mt-1 leading-snug">
                            Cómo cambia el costo laboral y el margen para <span className="underline">{monthTitle}</span> con la
                            misma demanda SLA: <span className="tabular-nums">{sla}</span> h
                        </p>
                        {slaNote && (
                            <p className="text-[10px] font-bold text-amber-800 dark:text-amber-200 mt-1.5 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-2 py-1 border border-amber-200 dark:border-amber-800">
                                {slaNote}
                            </p>
                        )}
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/80 dark:hover:bg-slate-800 text-slate-500 shrink-0">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-snug">
                        Cada columna es un escenario: editá <strong>N personas</strong> y el <strong>texto de cabecera</strong>. Las tres
                        compiten con la misma SLA; horas normales = min(SLA, N×192), extras = resto (recargo según esquema: 4×2 con
                        mezcla 100%/50%).
                    </p>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setScenarios(DEFAULT_SCENARIOS.map((s) => ({ ...s })))}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-[10px] font-black uppercase text-slate-700 dark:text-slate-200"
                        >
                            <RotateCcw size={12} /> Ejemplo 18 / 17 / 15
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const v = mergeDefaultServiceMarginVariables({
                                    totalSlaHours: slaHours,
                                    ...(price !== '' ? { sellingPricePerHour: Number(price) } : {}),
                                    ...(baseCost !== '' ? { baseEmployeeCostMonthlyARS: Number(baseCost) } : {}),
                                });
                                setScenarios((prev) =>
                                    prev.map((s) => {
                                        const avg = v.averageBillableHoursPerEmployeeByScheme[s.scheme] || 192;
                                        const n = slaHours <= 0 ? 0 : Math.ceil(slaHours / Math.max(1, avg));
                                        return { ...s, headcount: n };
                                    }),
                                );
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 px-2 py-1.5 text-[10px] font-black uppercase text-indigo-800 dark:text-indigo-200"
                        >
                            <Sparkles size={12} /> N mínimo por esquema
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-black uppercase text-slate-500">$/h vendida (opc.)</span>
                            <input
                                type="number"
                                min={0}
                                placeholder="16500"
                                value={price}
                                onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                            />
                        </label>
                        <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-black uppercase text-slate-500">Costo empleado / mes ARS (opc.)</span>
                            <input
                                type="number"
                                min={0}
                                placeholder="1732964"
                                value={baseCost}
                                onChange={(e) => setBaseCost(e.target.value === '' ? '' : Number(e.target.value))}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                            />
                        </label>
                    </div>

                    <div className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200 px-2 py-1.5 text-[10px] font-black">
                        <TrendingUp size={12} /> Mejor margen (esta comparativa): {winnerLabel || '—'}
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-[10px] min-w-[520px]">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800">
                                    <th className="text-left px-2 py-2 font-black text-slate-600 dark:text-slate-300 w-[140px]">
                                        Concepto
                                    </th>
                                    {scenarios.map((s, idx) => {
                                        const col = columns[idx];
                                        const isWin = col && winnerColumnId && col.id === winnerColumnId;
                                        return (
                                            <th
                                                key={s.id}
                                                className={`text-right px-2 py-2 font-black whitespace-nowrap align-bottom ${
                                                    isWin ? 'bg-emerald-100/80 dark:bg-emerald-900/25 text-emerald-900 dark:text-emerald-100' : 'text-slate-700 dark:text-slate-200'
                                                }`}
                                            >
                                                <input
                                                    type="text"
                                                    value={s.label}
                                                    onChange={(e) => updateScenario(s.id, { label: e.target.value })}
                                                    className="w-full min-w-[100px] max-w-[140px] text-right font-black bg-transparent border-b border-dashed border-slate-300 dark:border-slate-600 mb-1"
                                                />
                                                <div className="flex items-center justify-end gap-1">
                                                    <span className="text-[8px] font-bold text-slate-500">N</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        className="w-12 text-right font-black rounded border border-slate-200 dark:border-slate-600 px-1 py-0.5 bg-white dark:bg-slate-900"
                                                        value={s.headcount === 0 ? '' : String(s.headcount)}
                                                        onChange={(e) => {
                                                            const raw = e.target.value;
                                                            if (raw === '') updateScenario(s.id, { headcount: 0 });
                                                            else {
                                                                const n = parseInt(raw, 10);
                                                                updateScenario(s.id, {
                                                                    headcount: Number.isFinite(n) ? Math.max(0, n) : 0,
                                                                });
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[8px] font-bold text-slate-400 block font-mono">
                                                    {s.scheme === WorkScheme.SixTwo ? '6×2' : s.scheme === WorkScheme.SixOne ? '6×1' : '4×2'}
                                                </span>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Capacidad total (192h pp)</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-black tabular-nums">
                                            {Math.round(c.capacityTotal192).toLocaleString('es-AR')} hs
                                        </td>
                                    ))}
                                </tr>
                                <tr className="bg-slate-50/80 dark:bg-slate-800/40">
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">SLA (demanda)</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-black tabular-nums">
                                            {Math.round(c.slaDemand).toLocaleString('es-AR')} hs
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Horas normales</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-bold tabular-nums">
                                            {Math.round(c.normalHours).toLocaleString('es-AR')} hs
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Horas extras necesarias</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-bold text-amber-800 dark:text-amber-200 tabular-nums">
                                            {Math.round(c.overtimeHours).toLocaleString('es-AR')} hs
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Costo sueldos (fijo)</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-bold tabular-nums">
                                            ${formatARS(c.payrollFixedARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">
                                        Costo extras (variable){' '}
                                        <span className="text-[8px] font-normal text-slate-400">(4×2: mix recargos)</span>
                                    </td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-bold tabular-nums">
                                            ${formatARS(c.overtimeVariableARS)}
                                            {c.scheme === WorkScheme.FourTwo && c.overtimeHours > 0 ? (
                                                <span className="text-[8px] text-slate-400"> *</span>
                                            ) : null}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="bg-slate-100 dark:bg-slate-800/80">
                                    <td className="px-2 py-1.5 font-black text-slate-800 dark:text-slate-100">Costo laboral total</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-black tabular-nums">
                                            ${formatARS(c.totalLaborARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-600 dark:text-slate-300">Ingreso SLA (h × precio)</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
                                            ${formatARS(c.revenueARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-black text-slate-800 dark:text-slate-100">Utilidad bruta</td>
                                    {columns.map((c) => (
                                        <td
                                            key={c.id}
                                            className={`text-right px-2 py-1.5 font-black tabular-nums ${c.grossMarginARS >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}
                                        >
                                            ${formatARS(c.grossMarginARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Margen %</td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="text-right px-2 py-1.5 font-black tabular-nums">
                                            {c.marginPct.toFixed(1)}%
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <p className="text-[8px] text-slate-500 font-bold">* Columna 4×2: extras con mezcla 50% al 100% y 50% al 50% sobre costo hora base.</p>

                    {alerts.length > 0 && (
                        <ul className="list-disc list-inside text-[10px] font-bold text-rose-800 dark:text-rose-200 space-y-1">
                            {alerts.map((a, i) => (
                                <li key={i}>{a}</li>
                            ))}
                        </ul>
                    )}

                    <p className="text-[9px] text-slate-500 font-bold">
                        Parámetros en <code className="text-[8px]">serviceMarginOptimizer.variables.json</code>. Simulación orientativa.
                    </p>
                </div>
            </div>
        </div>
    );
}
