'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, TrendingUp, Shield } from 'lucide-react';
import {
    evaluateServiceMargin,
    formatARS,
    mergeDefaultServiceMarginVariables,
    WorkScheme,
} from '@/lib/servicios/serviceMarginOptimizer';

const SCHEME_LABEL: Record<WorkScheme, string> = {
    [WorkScheme.SixTwo]: '6×2 (8 h)',
    [WorkScheme.SixOne]: '6×1 (8 h)',
    [WorkScheme.FourTwo]: '4×2 (12 h)',
};

export interface ServiceMarginAnalyzerProps {
    /** Horas SLA del mes de referencia (p. ej. KPI del listado). */
    initialSlaHours: number;
}

export function ServiceMarginAnalyzer({ initialSlaHours }: ServiceMarginAnalyzerProps) {
    const [slaHours, setSlaHours] = useState(() => Math.max(0, Math.round(initialSlaHours)));
    const [price, setPrice] = useState<number | ''>('');
    const [baseCost, setBaseCost] = useState<number | ''>('');

    useEffect(() => {
        if (initialSlaHours > 0) setSlaHours(Math.round(initialSlaHours));
    }, [initialSlaHours]);

    const evaluation = useMemo((): ReturnType<typeof evaluateServiceMargin> | null => {
        const v = mergeDefaultServiceMarginVariables({
            totalSlaHours: slaHours,
            ...(price !== '' ? { sellingPricePerHour: Number(price) } : {}),
            ...(baseCost !== '' ? { baseEmployeeCostMonthlyARS: Number(baseCost) } : {}),
        });
        if (!Number.isFinite(v.totalSlaHours) || v.totalSlaHours < 0) return null;
        return evaluateServiceMargin(v);
    }, [slaHours, price, baseCost]);

    if (!evaluation) return null;

    const { rows, winnerByMargin, winnerByOperationalSafety, alerts } = evaluation;

    return (
        <div className="rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/80 to-white dark:from-slate-900 dark:to-slate-800 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-indigo-600 text-white">
                        <Activity size={16} />
                    </div>
                    <div>
                        <h2 className="text-[11px] font-black uppercase tracking-wide text-indigo-900 dark:text-indigo-200">
                            Analizador de margen (SLA vs esquema)
                        </h2>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold leading-snug max-w-xl">
                            Comparativa 6×2 / 6×1 / 4×2 con extras sobre cupo {evaluation.variables.maxNormalHoursPerEmployee}h. Valores por defecto en{' '}
                            <code className="text-[9px]">serviceMarginOptimizer.variables.json</code>.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-500">Horas SLA mes</span>
                    <input
                        type="number"
                        min={0}
                        value={slaHours}
                        onChange={(e) => setSlaHours(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                        className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                    />
                </label>
                <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-500">$/h vendida (opcional)</span>
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

            <div className="flex flex-wrap gap-2 mb-3 text-[10px] font-black">
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 px-2 py-1">
                    <TrendingUp size={12} />
                    Ganador rentabilidad: {SCHEME_LABEL[winnerByMargin]}
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-900 dark:text-sky-200 px-2 py-1">
                    <Shield size={12} />
                    Ganador operativo (reserva): {SCHEME_LABEL[winnerByOperationalSafety]}
                </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900">
                <table className="w-full text-[10px]">
                    <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            <th className="text-left px-2 py-2 font-black">Variable</th>
                            {rows.map((r) => (
                                <th key={r.scheme} className="text-right px-2 py-2 font-black whitespace-nowrap">
                                    {SCHEME_LABEL[r.scheme]}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Dotación sugerida</td>
                            {rows.map((r) => (
                                <td key={r.scheme} className="text-right px-2 py-1.5 font-black text-slate-900 dark:text-white">
                                    {r.employeesNeeded}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Horas reserva (N×192 − SLA)</td>
                            {rows.map((r) => (
                                <td key={r.scheme} className="text-right px-2 py-1.5 font-bold text-slate-800 dark:text-slate-100">
                                    {Math.round(r.reserveHours)} hs
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Horas extra (modelo)</td>
                            {rows.map((r) => (
                                <td key={r.scheme} className="text-right px-2 py-1.5 font-bold text-amber-800 dark:text-amber-200">
                                    {Math.round(r.overtimeHours)} hs
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Costo laboral estimado</td>
                            {rows.map((r) => (
                                <td key={r.scheme} className="text-right px-2 py-1.5 font-black text-slate-900 dark:text-white">
                                    ${formatARS(r.totalLaborARS)}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Ingreso SLA (h×precio)</td>
                            {rows.map((r) => (
                                <td key={r.scheme} className="text-right px-2 py-1.5 font-bold text-indigo-800 dark:text-indigo-200">
                                    ${formatARS(r.revenueARS)}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Margen bruto</td>
                            {rows.map((r) => (
                                <td
                                    key={r.scheme}
                                    className={`text-right px-2 py-1.5 font-black ${r.grossMarginARS >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}
                                >
                                    ${formatARS(r.grossMarginARS)}
                                </td>
                            ))}
                        </tr>
                        <tr>
                            <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">% margen</td>
                            {rows.map((r) => (
                                <td key={r.scheme} className="text-right px-2 py-1.5 font-black text-slate-900 dark:text-white">
                                    {r.marginPct.toFixed(1)}%
                                </td>
                            ))}
                        </tr>
                    </tbody>
                </table>
            </div>

            {alerts.length > 0 && (
                <ul className="mt-2 space-y-1 list-disc list-inside text-[10px] font-bold text-rose-800 dark:text-rose-200">
                    {alerts.map((a, i) => (
                        <li key={i}>{a}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
