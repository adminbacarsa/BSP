'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw, Sparkles, TrendingUp, Shield } from 'lucide-react';
import {
    evaluateServiceMargin,
    formatARS,
    mergeDefaultServiceMarginVariables,
    WorkScheme,
    WORK_SCHEME_ORDER,
} from '@/lib/servicios/serviceMarginOptimizer';

const SCHEME_LABEL: Record<WorkScheme, string> = {
    [WorkScheme.SixTwo]: '6×2 (8 h)',
    [WorkScheme.SixOne]: '6×1 (8 h)',
    [WorkScheme.FourTwo]: '4×2 (12 h)',
};

export interface ServiceMarginPerServiceModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    slaHours: number;
    kpiMonthLabel: string;
}

type HeadStrings = Record<WorkScheme, string>;

const emptyHeads = (): HeadStrings => ({
    [WorkScheme.SixTwo]: '',
    [WorkScheme.SixOne]: '',
    [WorkScheme.FourTwo]: '',
});

function parseHeadcounts(h: HeadStrings): Partial<Record<WorkScheme, number>> {
    const out: Partial<Record<WorkScheme, number>> = {};
    for (const scheme of WORK_SCHEME_ORDER) {
        const s = String(h[scheme] ?? '').trim();
        if (s === '') continue;
        const n = parseInt(s, 10);
        if (Number.isFinite(n) && n >= 0) out[scheme] = n;
    }
    return out;
}

export function ServiceMarginPerServiceModal({
    open,
    onClose,
    title,
    subtitle,
    slaHours,
    kpiMonthLabel,
}: ServiceMarginPerServiceModalProps) {
    const [heads, setHeads] = useState<HeadStrings>(emptyHeads);
    const [price, setPrice] = useState<number | ''>('');
    const [baseCost, setBaseCost] = useState<number | ''>('');

    useEffect(() => {
        if (open) setHeads(emptyHeads());
    }, [open, slaHours]);

    const evaluation = useMemo(() => {
        const v = mergeDefaultServiceMarginVariables({
            totalSlaHours: slaHours,
            ...(price !== '' ? { sellingPricePerHour: Number(price) } : {}),
            ...(baseCost !== '' ? { baseEmployeeCostMonthlyARS: Number(baseCost) } : {}),
        });
        return evaluateServiceMargin(v, parseHeadcounts(heads));
    }, [slaHours, price, baseCost, heads]);

    if (!open) return null;

    const { rows, winnerByMargin, winnerByOperationalSafety, alerts } = evaluation;

    const applySuggested = () => {
        const next = emptyHeads();
        for (const r of rows) next[r.scheme] = String(r.suggestedHeadcount);
        setHeads(next);
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/80 dark:bg-slate-900">
                    <div className="min-w-0">
                        <h2 className="text-sm font-black text-indigo-950 dark:text-indigo-100 uppercase tracking-wide">Margen por esquema</h2>
                        <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">{title}</p>
                        {subtitle && <p className="text-[10px] text-slate-500 font-bold mt-0.5">{subtitle}</p>}
                        <p className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 mt-1">
                            SLA mes listado ({kpiMonthLabel}): <span className="tabular-nums">{Math.round(slaHours)}</span> h
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/80 dark:hover:bg-slate-800 text-slate-500">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold leading-snug">
                        Editá la <strong>dotación (N personas)</strong> por esquema para comparar (ej. 15 en 4×2 vs 18 en 6×2). Dejá vacío para usar la sugerencia automática por columna.
                    </p>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setHeads(emptyHeads())}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-[10px] font-black uppercase text-slate-700 dark:text-slate-200"
                        >
                            <RotateCcw size={12} /> Todo automático
                        </button>
                        <button
                            type="button"
                            onClick={applySuggested}
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 px-2 py-1.5 text-[10px] font-black uppercase text-indigo-800 dark:text-indigo-200"
                        >
                            <Sparkles size={12} /> Rellenar sugeridos
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                            <span className="text-[9px] font-black uppercase text-slate-500">Costo empleado / mes (opc.)</span>
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

                    <div className="flex flex-wrap gap-2 text-[10px] font-black">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200 px-2 py-1">
                            <TrendingUp size={12} /> Rentabilidad: {SCHEME_LABEL[winnerByMargin]}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-sky-100 dark:bg-sky-900/30 text-sky-900 dark:text-sky-200 px-2 py-1">
                            <Shield size={12} /> Reserva: {SCHEME_LABEL[winnerByOperationalSafety]}
                        </span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
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
                                <tr className="bg-indigo-50/50 dark:bg-indigo-950/20">
                                    <td className="px-2 py-1.5 font-bold text-indigo-900 dark:text-indigo-200">Dotación N</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-1 py-1 align-top">
                                            <div className="flex flex-col items-end gap-0.5">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    placeholder={`sug. ${r.suggestedHeadcount}`}
                                                    value={heads[r.scheme]}
                                                    onChange={(e) =>
                                                        setHeads((prev) => ({ ...prev, [r.scheme]: e.target.value }))
                                                    }
                                                    className="w-16 rounded border border-indigo-200 dark:border-indigo-800 px-1 py-0.5 text-right font-black bg-white dark:bg-slate-900"
                                                />
                                                <span className="text-[8px] font-bold text-slate-500">sug. {r.suggestedHeadcount}</span>
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">N usado</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-2 py-1.5 font-black text-slate-900 dark:text-white">
                                            {r.headcountUsed}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Reserva (N×192 − SLA)</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-2 py-1.5 font-bold">
                                            {Math.round(r.reserveHours)} hs
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Extras (modelo)</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-2 py-1.5 font-bold text-amber-800 dark:text-amber-200">
                                            {Math.round(r.overtimeHours)} hs
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Costo laboral</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-2 py-1.5 font-black">
                                            ${formatARS(r.totalLaborARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Ingreso SLA</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-2 py-1.5 font-bold text-indigo-700 dark:text-indigo-300">
                                            ${formatARS(r.revenueARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">Margen bruto</td>
                                    {rows.map((r) => (
                                        <td
                                            key={r.scheme}
                                            className={`text-right px-2 py-1.5 font-black ${r.grossMarginARS >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
                                        >
                                            ${formatARS(r.grossMarginARS)}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200">% margen</td>
                                    {rows.map((r) => (
                                        <td key={r.scheme} className="text-right px-2 py-1.5 font-black">
                                            {r.marginPct.toFixed(1)}%
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {alerts.length > 0 && (
                        <ul className="list-disc list-inside text-[10px] font-bold text-rose-800 dark:text-rose-200 space-y-1">
                            {alerts.map((a, i) => (
                                <li key={i}>{a}</li>
                            ))}
                        </ul>
                    )}

                    <p className="text-[9px] text-slate-500 font-bold">
                        Valores base en <code className="text-[8px]">serviceMarginOptimizer.variables.json</code>. Simulación; no reemplaza liquidación real.
                    </p>
                </div>
            </div>
        </div>
    );
}
