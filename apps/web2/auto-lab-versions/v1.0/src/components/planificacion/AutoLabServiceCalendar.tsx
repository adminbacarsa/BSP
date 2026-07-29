import React, { useMemo } from 'react';
import {
    buildCalendarMonthsForService,
    isHolidayDate,
    isWeekendDate,
} from '@/lib/planificacion/autoLabServicePeriod';
import type { AutoLabAbsenceCode, AutoLabAbsenceDraft, AutoLabCustomPositionDraft } from '@/lib/planificacion/autoLabCustomCase';
import { AUTO_LAB_ABSENCE_CODES } from '@/lib/planificacion/autoLabCustomCase';

const WD_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export type AutoLabCalendarMode = 'exclude' | 'absence';

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
    calendarMode: AutoLabCalendarMode;
    onCalendarModeChange: (mode: AutoLabCalendarMode) => void;
    absenceEmpId: string;
    onAbsenceEmpIdChange: (empId: string) => void;
    absenceCode: AutoLabAbsenceCode;
    onAbsenceCodeChange: (code: AutoLabAbsenceCode) => void;
    absences: AutoLabAbsenceDraft[];
    employees: Array<{ id: string; nombre?: string }>;
    onToggleAbsence: (dateStr: string) => void;
    onClearAbsences: () => void;
}

function shortGuardLabel(emp: { id: string; nombre?: string }): string {
    const m = (emp.nombre || emp.id).match(/(\d+)/);
    return m ? `G${m[1]}` : (emp.nombre || emp.id).slice(0, 6);
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
    calendarMode,
    onCalendarModeChange,
    absenceEmpId,
    onAbsenceEmpIdChange,
    absenceCode,
    onAbsenceCodeChange,
    absences,
    employees,
    onToggleAbsence,
    onClearAbsences,
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

    const absencesByDate = useMemo(() => {
        const map = new Map<string, AutoLabAbsenceDraft[]>();
        for (const a of absences) {
            if (!map.has(a.dateStr)) map.set(a.dateStr, []);
            map.get(a.dateStr)!.push(a);
        }
        return map;
    }, [absences]);

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

    const handleDayClick = (ds: string) => {
        if (calendarMode === 'absence') onToggleAbsence(ds);
        else onToggleExcluded(ds);
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p className="text-xs font-black uppercase text-slate-600">Calendario del servicio</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            {serviceStartDate} → {serviceEndDate}
                            {totalExcluded > 0 && (
                                <span className="ml-2 text-rose-600 font-bold">{totalExcluded} excluido(s)</span>
                            )}
                            {absences.length > 0 && (
                                <span className="ml-2 text-violet-700 font-bold">{absences.length} ausencia(s)</span>
                            )}
                        </p>
                    </div>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[10px] font-black">
                        <button
                            type="button"
                            onClick={() => onCalendarModeChange('exclude')}
                            className={`px-2.5 py-1.5 ${calendarMode === 'exclude' ? 'bg-rose-600 text-white' : 'bg-white text-slate-600'}`}
                        >
                            Exclusión SLA
                        </button>
                        <button
                            type="button"
                            onClick={() => onCalendarModeChange('absence')}
                            className={`px-2.5 py-1.5 ${calendarMode === 'absence' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600'}`}
                        >
                            Ausencia guardia
                        </button>
                    </div>
                </div>

                {calendarMode === 'exclude' ? (
                    <div className="flex items-center gap-2 flex-wrap">
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
                                Limpiar exclusiones
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={absenceEmpId}
                            onChange={(e) => onAbsenceEmpIdChange(e.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold bg-white"
                        >
                            {employees.map((e) => (
                                <option key={e.id} value={e.id}>{shortGuardLabel(e)}</option>
                            ))}
                        </select>
                        <select
                            value={absenceCode}
                            onChange={(e) => onAbsenceCodeChange(e.target.value as AutoLabAbsenceCode)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold bg-white"
                        >
                            {AUTO_LAB_ABSENCE_CODES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                        {absences.length > 0 && (
                            <button
                                type="button"
                                onClick={onClearAbsences}
                                className="text-[10px] font-bold text-violet-600 hover:text-violet-800"
                            >
                                Limpiar ausencias
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="p-4 space-y-4 max-h-[480px] overflow-y-auto">
                <p className="text-[10px] text-slate-500">
                    {calendarMode === 'exclude'
                        ? <>Click en un día para marcarlo <strong>sin servicio</strong> (exclusión SLA).</>
                        : <>Click en un día para marcar <strong>ausencia</strong> del guardia seleccionado ({absenceCode}). El cerebro activa modo 12 / cobertura según reglas.</>}
                    {' '}Mes simulado: <strong>{simulationMonth}/{simulationYear}</strong>.
                </p>

                <div className="flex flex-wrap gap-3 text-[9px] font-bold uppercase text-slate-500">
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-300" /> Vigente
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-rose-100 border border-rose-400" /> Excluido
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-violet-200 border border-violet-400" /> Ausencia
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" /> Feriado AR
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded ring-2 ring-emerald-400 bg-white" /> Mes simulado
                    </span>
                </div>

                {calendarMode === 'absence' && absences.length > 0 && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2 max-h-24 overflow-y-auto">
                        <p className="text-[9px] font-black uppercase text-violet-800 mb-1">Ausencias cargadas</p>
                        <div className="flex flex-wrap gap-1">
                            {absences.map((a) => (
                                <span
                                    key={`${a.empId}-${a.dateStr}`}
                                    className="text-[9px] font-bold bg-white border border-violet-200 rounded px-1.5 py-0.5 text-violet-900"
                                >
                                    {shortGuardLabel(employees.find((e) => e.id === a.empId) || { id: a.empId })}
                                    {' '}{a.dateStr} {a.code}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

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
                                                className="h-8 rounded-lg bg-slate-100/80 text-[10px] text-slate-300 flex items-center justify-center"
                                            >
                                                {date.getDate()}
                                            </div>
                                        );
                                    }

                                    const dayAbsences = absencesByDate.get(ds) || [];
                                    const empAbsence = dayAbsences.find((a) => a.empId === absenceEmpId);
                                    const excludedHere = calendarMode === 'exclude' && activeExcluded.has(ds);
                                    const holiday = isHolidayDate(ds);
                                    const weekend = isWeekendDate(date);

                                    let cellClass = 'bg-indigo-50 border-indigo-200 text-indigo-900 hover:bg-indigo-100';
                                    if (calendarMode === 'exclude' && excludedHere) {
                                        cellClass = 'bg-rose-100 border-rose-400 text-rose-800';
                                    } else if (calendarMode === 'absence' && empAbsence) {
                                        cellClass = 'bg-violet-200 border-violet-500 text-violet-950';
                                    } else if (holiday) {
                                        cellClass = 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100';
                                    } else if (weekend) {
                                        cellClass = 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200';
                                    }

                                    return (
                                        <button
                                            key={ds}
                                            type="button"
                                            onClick={() => handleDayClick(ds)}
                                            title={ds}
                                            className={`h-8 rounded-lg text-[10px] font-bold border transition-colors flex flex-col items-center justify-center leading-none ${cellClass}`}
                                        >
                                            <span>{date.getDate()}</span>
                                            {calendarMode === 'absence' && empAbsence && (
                                                <span className="text-[7px] font-black mt-0.5">{empAbsence.code}</span>
                                            )}
                                            {calendarMode === 'absence' && !empAbsence && dayAbsences.length > 0 && (
                                                <span className="text-[7px] text-violet-700">+{dayAbsences.length}</span>
                                            )}
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
