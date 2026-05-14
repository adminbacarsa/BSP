'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw, Sparkles, TrendingUp } from 'lucide-react';
import {
    buildServiceMarginVariablesForUi,
    defaultNominaComparisonScenarios,
    evaluateAdjustedNominaScenarios,
    formatARS,
    overtimeVariableCostExplanationLines,
    schemeLabelShort,
    suggestedNominaColumnLabel,
    type LaborCostInputMode,
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
    const [laborMode, setLaborMode] = useState<LaborCostInputMode>('monthly_loaded');
    const [monthlyLoaded, setMonthlyLoaded] = useState<number | ''>('');
    const [hourlyLoaded, setHourlyLoaded] = useState<number | ''>('');
    const [salaryMonthly, setSalaryMonthly] = useState<number | ''>('');
    const [structureMonthly, setStructureMonthly] = useState<number | ''>('');
    const [ot50, setOt50] = useState<number | ''>('');
    const [ot100, setOt100] = useState<number | ''>('');

    useEffect(() => {
        if (!open) return;
        setScenarios(DEFAULT_SCENARIOS.map((s) => ({ ...s })));
        setLaborMode('monthly_loaded');
        setMonthlyLoaded('');
        setHourlyLoaded('');
        setSalaryMonthly('');
        setStructureMonthly('');
        setOt50('');
        setOt100('');
        setPrice('');
    }, [open, slaHours]);

    const variables = useMemo(
        () =>
            buildServiceMarginVariablesForUi(slaHours, {
                sellingPricePerHour: price,
                laborMode,
                monthlyLoaded,
                hourlyLoaded,
                salaryMonthly,
                structureMonthly,
                overtime50Multiplier: ot50,
                overtime100Multiplier: ot100,
            }),
        [slaHours, price, laborMode, monthlyLoaded, hourlyLoaded, salaryMonthly, structureMonthly, ot50, ot100],
    );

    const evaluation = useMemo(
        () => evaluateAdjustedNominaScenarios(slaHours, variables, scenariosFromForm(scenarios)),
        [slaHours, variables, scenarios],
    );

    const impliedHourlyCost =
        variables.baseEmployeeCostMonthlyARS / Math.max(1, variables.maxNormalHoursPerEmployee);

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
                        Cada columna usa el <strong>N</strong> y el <strong>esquema</strong> (6×2 / 6×1 / 4×2). La{' '}
                        <strong>capacidad total</strong> es <strong>N × horas de presencia promedio al mes</strong> de ese esquema: depende
                        de cuántos <strong>días se trabaja vs francos</strong> en el calendario, no de un único “192 h por persona” para
                        comparar rotaciones. El <strong>192 h</strong> del SUVICO sigue usándose solo como <strong>tope</strong> para armar
                        el costo hora base de extras (costo mensual ÷ tope). El texto de cabecera es leyenda: <strong>N mínimo</strong>{' '}
                        alinea título con N.
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
                                setScenarios((prev) =>
                                    prev.map((s) => {
                                        const avg = variables.averageBillableHoursPerEmployeeByScheme[s.scheme] || 192;
                                        const n = slaHours <= 0 ? 0 : Math.ceil(slaHours / Math.max(1, avg));
                                        return { ...s, headcount: n, label: suggestedNominaColumnLabel(n, s.scheme) };
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
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black uppercase text-slate-500">Costo laboral por empleado</span>
                            <select
                                value={laborMode}
                                onChange={(e) => setLaborMode(e.target.value as LaborCostInputMode)}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-xs font-black bg-white dark:bg-slate-800"
                            >
                                <option value="monthly_loaded">Mensual ya cargado (sueldo + cargas en un monto)</option>
                                <option value="hourly_loaded">$/h costo empresa (× horas tope normales)</option>
                                <option value="salary_structure">Sueldo mensual + estructura / otros</option>
                            </select>
                        </div>
                    </div>

                    {laborMode === 'monthly_loaded' && (
                        <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-black uppercase text-slate-500">Costo empleado / mes ARS (opc.)</span>
                            <input
                                type="number"
                                min={0}
                                placeholder="1732964"
                                value={monthlyLoaded}
                                onChange={(e) => setMonthlyLoaded(e.target.value === '' ? '' : Number(e.target.value))}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                            />
                        </label>
                    )}
                    {laborMode === 'hourly_loaded' && (
                        <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-black uppercase text-slate-500">
                                $/h costo empresa ARS (opc.) — se multiplica por {variables.maxNormalHoursPerEmployee} h tope
                            </span>
                            <input
                                type="number"
                                min={0}
                                placeholder={String(Math.round(impliedHourlyCost))}
                                value={hourlyLoaded}
                                onChange={(e) => setHourlyLoaded(e.target.value === '' ? '' : Number(e.target.value))}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                            />
                        </label>
                    )}
                    {laborMode === 'salary_structure' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="flex flex-col gap-0.5">
                                <span className="text-[9px] font-black uppercase text-slate-500">Sueldo / aporte mensual ARS (opc.)</span>
                                <input
                                    type="number"
                                    min={0}
                                    value={salaryMonthly}
                                    onChange={(e) => setSalaryMonthly(e.target.value === '' ? '' : Number(e.target.value))}
                                    className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                                />
                            </label>
                            <label className="flex flex-col gap-0.5">
                                <span className="text-[9px] font-black uppercase text-slate-500">Estructura, indumentaria, gestión… / mes (opc.)</span>
                                <input
                                    type="number"
                                    min={0}
                                    value={structureMonthly}
                                    onChange={(e) => setStructureMonthly(e.target.value === '' ? '' : Number(e.target.value))}
                                    className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                                />
                            </label>
                        </div>
                    )}

                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 space-y-0.5">
                        <p>
                            Costo mensual por cabeza usado:{' '}
                            <span className="tabular-nums text-indigo-700 dark:text-indigo-300">
                                ${formatARS(variables.baseEmployeeCostMonthlyARS)}
                            </span>{' '}
                            (~{' '}
                            <span className="tabular-nums">${formatARS(impliedHourlyCost)}</span> /h modelo con tope{' '}
                            {variables.maxNormalHoursPerEmployee} h)
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-black uppercase text-slate-500">Recargo extra 50% (opc., ej. 1.5)</span>
                            <input
                                type="number"
                                min={0}
                                step={0.05}
                                placeholder="1.5"
                                value={ot50}
                                onChange={(e) => setOt50(e.target.value === '' ? '' : Number(e.target.value))}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                            />
                        </label>
                        <label className="flex flex-col gap-0.5">
                            <span className="text-[9px] font-black uppercase text-slate-500">Recargo extra 100% (opc., ej. 2)</span>
                            <input
                                type="number"
                                min={0}
                                step={0.05}
                                placeholder="2"
                                value={ot100}
                                onChange={(e) => setOt100(e.target.value === '' ? '' : Number(e.target.value))}
                                className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-sm font-bold bg-white dark:bg-slate-800"
                            />
                        </label>
                    </div>

                    <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5">
                        <summary className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 cursor-pointer">
                            Cómo se calcula el costo de horas extra (variable)
                        </summary>
                        <ul className="mt-2 space-y-1 text-[9px] font-bold text-slate-600 dark:text-slate-400 list-disc list-inside">
                            {overtimeVariableCostExplanationLines(variables).map((line, i) => (
                                <li key={i}>{line}</li>
                            ))}
                        </ul>
                    </details>

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
                                        const hsCap = col
                                            ? `${col.billableHoursPerEmployee.toFixed(2).replace(/\.?0+$/, '')} h/cab. (${schemeLabelShort(s.scheme)})`
                                            : '';
                                        return (
                                            <th
                                                key={s.id}
                                                title={
                                                    hsCap
                                                        ? `Capacidad: N × ${hsCap}. Según días trabajados/francos del esquema en el mes, no 192 h fijas.`
                                                        : undefined
                                                }
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
                                    <td
                                        className="px-2 py-1.5 font-bold text-slate-700 dark:text-slate-200 align-top max-w-[160px]"
                                        title="Las horas por cabeza vienen del calendario típico del esquema (días de trabajo y francos en el mes). No se usa aquí el fijo 192 h pp; el 192 h es solo tope para costo de extras."
                                    >
                                        <span className="block leading-tight">Capacidad total</span>
                                        <span className="block text-[8px] font-black uppercase text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                            según rotación (días trabajados / mes)
                                        </span>
                                    </td>
                                    {columns.map((c) => (
                                        <td
                                            key={c.id}
                                            className="text-right px-2 py-1.5 font-black tabular-nums align-top"
                                            title={`${schemeLabelShort(c.scheme)}: ~${c.billableHoursPerEmployee.toFixed(2)} h de presencia promedio por cabeza en el mes (francos del ciclo incluidos).`}
                                        >
                                            {Math.round(c.capacityBillableHours).toLocaleString('es-AR')} hs
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

                    <p className="text-[8px] text-slate-500 font-bold">
                        * Columna 4×2: el multiplicador efectivo de extra es promedio entre recargo 100% y 50% (ver desplegable arriba).
                    </p>

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
