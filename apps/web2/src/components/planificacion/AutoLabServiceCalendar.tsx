import React, { useMemo } from 'react';
import {
    buildCalendarMonthsForService,
    isHolidayDate,
    isWeekendDate,
} from '@/lib/planificacion/autoLabServicePeriod';
import type { AutoLabCustomPositionDraft } from '@/lib/planificacion/autoLabCustomCase';

const WD_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

interface AutoLabServiceCalendarProps {
    serviceStartDate: string;
    serviceEndDate: string;
    excludedDates: string[];
    positions: AutoLabCustomPositionDraft[];
    excludedScope: 'ALL' | string;
    onExcludedScopeChange: (scope: 'ALL' | string) => void;
    onToggleExcluded: (dateStr: string) => void;
    onClearScope: () => void;
    simulationYear: number;
    simulationMonth: number;
}

export default function AutoLabServiceCalendar({
    serviceStartDate,
    serviceEndDate,
    excludedDates,
    positions,
    excludedScope,
    onExcludedScopeChange,
    onToggleExcluded,
    onClearScope,
    simulationYear,
    simulationMonth,
}: AutoLabServiceCalendarProps) {
    const months = useMemo(
        () => buildCalendarMonthsForService(serviceStartDate, serviceEndDate),
        [serviceStartDate, serviceEndDate],
    );

    const slaGlobal = useMemo(() => new Set(excludedDates), [excludedDates]);

    const scopePos = excludedScope === 'ALL'
        ? null
        : positions.find((p) => p.id === excludedScope) ?? null;

    const activeExcluded = useMemo(() => {
        if (excludedScope === 'ALL') return slaGlobal;
        return new Set(scopePos?.excludedDates || []);
    }, [excludedScope, slaGlobal, scopePos]);

    const totalExcluded = slaGlobal.size + positions.reduce(
        (acc, p) => acc + (p.excludedDates?.length || 0),
        0,
    );

    if (!serviceStartDate || !serviceEndDate || months.length === 0) {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                Definí fecha de inicio y fin del servicio para ver el calendario.
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="text-xs font-black uppercase text-slate-600">Calendario del servicio</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        {serviceStartDate} → {serviceEndDate}
                        {totalExcluded > 0 && (
                            <span className="ml-2 text-rose-600 font-bold">{totalExcluded} día(s) excluido(s)</span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={excludedScope}
                        onChange={(e) => onExcludedScopeChange(e.target.value as 'ALL' | string)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold bg-white"
                    >
                        <option value="ALL">Excluir: todo el servicio</option>
                        {positions.map((p) => (
                            <option key={p.id} value={p.id}>
                                Excluir: {p.positionName}
                            </option>
                        ))}
                    </select>
                    {activeExcluded.size > 0 && (
                        <button
                            type="button"
                            onClick={onClearScope}
                            className="text-[10px] font-bold text-rose-600 hover:text-rose-800"
                        >
                            Limpiar scope
                        </button>
                    )}
                </div>
            </div>

            <div className="p-4 space-y-4 max-h-[420px] overflow-y-auto">
                <p className="text-[10px] text-slate-500">
                    Click en un día dentro de la vigencia para marcarlo como <strong>sin servicio</strong>.
                    Mes simulado: <strong>{simulationMonth}/{simulationYear}</strong> (barra superior).
                </p>

                <div className="flex flex-wrap gap-3 text-[9px] font-bold uppercase text-slate-500">
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-300" /> Vigente
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-rose-100 border border-rose-400" /> Excluido
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" /> Feriado AR
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded ring-2 ring-emerald-400 bg-white" /> Mes simulado
                    </span>
                </div>

                {months.map((mo) => {
                    const isSimMonth = mo.year === simulationYear && mo.month + 1 === simulationMonth;
                    const firstDow = mo.days[0]?.date.getDay() ?? 0;
                    const pad = firstDow === 0 ? 6 : firstDow - 1;

                    return (
                        <div
                            key={`${mo.year}-${mo.month}`}
                            className={`rounded-xl border p-3 ${isSimMonth ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200'}`}
                        >
                            <p className="text-[11px] font-black text-slate-700 capitalize mb-2">{mo.label}</p>
                            <div className="grid grid-cols-7 gap-1 mb-1">
                                {WD_HEADERS.map((h) => (
                                    <div key={h} className="text-center text-[9px] font-black text-slate-400">{h}</div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7 gap-1">
                                {Array.from({ length: pad }).map((_, i) => (
                                    <div key={`pad-${i}`} />
                                ))}
                                {mo.days.map(({ date, ds, inRange }) => {
                                    if (!inRange || !ds) {
                                        return (
                                            <div
                                                key={`out-${date.getTime()}`}
                                                className="h-7 rounded-lg bg-slate-100/80 text-[10px] text-slate-300 flex items-center justify-center"
                                            >
                                                {date.getDate()}
                                            </div>
                                        );
                                    }

                                    const excludedHere = activeExcluded.has(ds);
                                    const alsoSlaGlobal = slaGlobal.has(ds) && excludedScope !== 'ALL';
                                    const holiday = isHolidayDate(ds);
                                    const weekend = isWeekendDate(date);

                                    return (
                                        <button
                                            key={ds}
                                            type="button"
                                            onClick={() => onToggleExcluded(ds)}
                                            title={ds}
                                            className={`h-7 rounded-lg text-[10px] font-bold border transition-colors ${
                                                excludedHere
                                                    ? 'bg-rose-100 border-rose-400 text-rose-800'
                                                    : holiday
                                                      ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                                                      : weekend
                                                        ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                                                        : 'bg-indigo-50 border-indigo-200 text-indigo-900 hover:bg-indigo-100'
                                            } ${alsoSlaGlobal ? 'ring-1 ring-rose-300' : ''}`}
                                        >
                                            {date.getDate()}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
