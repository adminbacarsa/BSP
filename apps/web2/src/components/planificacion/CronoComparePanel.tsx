import React, { useMemo, useState } from 'react';
import {
    CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Maximize2, Minimize2, Users, X,
} from 'lucide-react';
import {
    CRONO_COMPARE_SHIFT_STYLES,
    buildCronoCompareEmployees,
    cronoCompareDateKey,
    cronoCompareDayLetter,
    inferAbsenceCellStyle,
    resolveCommittedShiftAtObjective,
} from '@/lib/planificacion/cronoCompareUtils';

export type CronoComparePanelProps = {
    clients: any[];
    employees: any[];
    shiftsMap: Record<string, any>;
    absencesMap: Record<string, any>;
    slaIdToObjId: Record<string, string>;
    clientId: string;
    objectiveId: string;
    monthDate: Date;
    mainObjectiveId?: string;
    mode?: 'popout' | 'embedded';
    onClientChange: (clientId: string) => void;
    onObjectiveChange: (objectiveId: string) => void;
    onMonthChange: (monthDate: Date) => void;
    onClose?: () => void;
};

export function CronoComparePanel({
    clients,
    employees,
    shiftsMap,
    absencesMap,
    slaIdToObjId,
    clientId,
    objectiveId,
    monthDate,
    mainObjectiveId = '',
    mode = 'embedded',
    onClientChange,
    onObjectiveChange,
    onMonthChange,
    onClose,
}: CronoComparePanelProps) {
    const [openClientDrop, setOpenClientDrop] = useState(false);
    const [openObjDrop, setOpenObjDrop] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const daysInMonth = useMemo(() => {
        const d = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const days: Date[] = [];
        while (d.getMonth() === monthDate.getMonth()) {
            days.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }
        return days;
    }, [monthDate]);

    const gridEmployees = useMemo(
        () => buildCronoCompareEmployees(employees, objectiveId, shiftsMap, slaIdToObjId),
        [employees, objectiveId, shiftsMap, slaIdToObjId],
    );

    const clientName = clients.find((c) => c.id === clientId)?.name || 'Cliente';
    const objectivesForClient = useMemo(() => {
        const client = clients.find((c) => c.id === clientId);
        return [...(client?.objetivos || [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    }, [clients, clientId]);

    const objectiveName = useMemo(() => {
        const obj = objectivesForClient.find((o: any) => (o.id || o.name) === objectiveId);
        return obj?.name || objectiveId || 'Objetivo';
    }, [objectivesForClient, objectiveId]);

    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                setIsFullscreen(false);
            } else {
                await document.documentElement.requestFullscreen();
                setIsFullscreen(true);
            }
        } catch {
            /* navegador puede bloquear */
        }
    };

    React.useEffect(() => {
        const onFs = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFs);
        return () => document.removeEventListener('fullscreenchange', onFs);
    }, []);

    return (
        <div className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-950">
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-slate-900 text-white border-b border-slate-700 select-none">
                <CalendarCheck size={14} className="text-indigo-400 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-400 shrink-0">
                    {mode === 'popout' ? 'Crono · pantalla extra' : 'Crono comparación'}
                </span>
                <span className="text-slate-600">·</span>
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => { setOpenClientDrop((v) => !v); setOpenObjDrop(false); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[10px] font-black uppercase max-w-[140px]"
                    >
                        <span className="truncate">{clientName}</span>
                        <ChevronDown size={10} />
                    </button>
                    {openClientDrop && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-xl min-w-[200px] max-h-48 overflow-y-auto text-slate-800">
                            {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => { onClientChange(c.id); setOpenClientDrop(false); }}
                                    className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-indigo-50 ${c.id === clientId ? 'bg-indigo-100 text-indigo-800' : ''}`}
                                >
                                    {c.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <ChevronRight size={10} className="text-slate-500 shrink-0" />
                <div className="relative min-w-0 flex-1">
                    <button
                        type="button"
                        disabled={!clientId}
                        onClick={() => { setOpenObjDrop((v) => !v); setOpenClientDrop(false); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-700 hover:bg-indigo-600 text-[10px] font-black uppercase max-w-full disabled:opacity-40"
                    >
                        <span className="truncate">{objectiveId ? objectiveName : 'Elegir objetivo'}</span>
                        <ChevronDown size={10} className="shrink-0" />
                    </button>
                    {openObjDrop && clientId && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-xl min-w-[220px] max-h-48 overflow-y-auto text-slate-800">
                            {objectivesForClient.map((o: any) => {
                                const oid = o.id || o.name;
                                const isMain = oid === mainObjectiveId;
                                return (
                                    <button
                                        key={oid}
                                        type="button"
                                        onClick={() => { onObjectiveChange(oid); setOpenObjDrop(false); }}
                                        className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-indigo-50 ${oid === objectiveId ? 'bg-indigo-600 text-white hover:bg-indigo-600' : ''}`}
                                    >
                                        {o.name}
                                        {isMain && <span className="ml-1 text-[9px] opacity-70">(principal)</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="flex items-center bg-slate-800 rounded-lg p-0.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => onMonthChange(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
                        className="p-1 hover:bg-slate-700 rounded-md"
                        aria-label="Mes anterior"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="px-2 font-black text-[10px] w-[4.5rem] text-center capitalize">
                        {monthDate.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })}
                    </span>
                    <button
                        type="button"
                        onClick={() => onMonthChange(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
                        className="p-1 hover:bg-slate-700 rounded-md"
                        aria-label="Mes siguiente"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
                <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg shrink-0"
                    title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa (F11)'}
                >
                    {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg shrink-0"
                        title="Cerrar"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            <div className="shrink-0 px-3 py-1 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900 text-[9px] font-bold text-indigo-700 dark:text-indigo-300">
                Solo lectura · turnos guardados · mové esta ventana al monitor extra y usá pantalla completa
            </div>

            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-slate-50 dark:bg-slate-950">
                {!objectiveId ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 p-6 text-center">
                        <Users size={28} className="opacity-40" />
                        <p className="text-sm font-bold">Elegí un objetivo para ver su cronograma</p>
                    </div>
                ) : gridEmployees.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm p-6">Sin dotación para este objetivo</div>
                ) : (
                    <table className="border-separate border-spacing-0 w-full text-xs min-w-max">
                        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 shadow-sm">
                            <tr>
                                <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 p-2 text-left border-b border-r min-w-[140px] max-w-[200px]">
                                    <span className="text-[10px] font-black uppercase text-slate-500"><Users size={11} className="inline mr-1" />Dotación</span>
                                    <span className="block text-[8px] font-bold text-slate-400">{gridEmployees.length} guardias</span>
                                </th>
                                {daysInMonth.map((d) => {
                                    const dateStr = cronoCompareDateKey(d);
                                    const isWeekend = [0, 6].includes(d.getDay());
                                    return (
                                        <th key={dateStr} className={`min-w-[26px] border-b border-r p-0.5 text-center ${isWeekend ? 'bg-rose-50 dark:bg-rose-950/30' : ''}`}>
                                            <div className="text-[8px] font-black text-slate-400">{cronoCompareDayLetter(dateStr)}</div>
                                            <div className={`text-[10px] font-bold ${isWeekend ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>{d.getDate()}</div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {gridEmployees.map((emp) => {
                                const isGuest = emp.preferredObjectiveId !== objectiveId && slaIdToObjId[emp.preferredObjectiveId] !== objectiveId;
                                return (
                                    <tr key={emp.id} className="hover:bg-white/80 dark:hover:bg-slate-800/50">
                                        <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-b p-1.5 max-w-[200px]">
                                            <span className="text-[9px] font-bold truncate block text-slate-700 dark:text-slate-200" title={emp.name}>
                                                {emp.name}
                                                {isGuest && <span className="ml-1 text-[7px] font-black text-amber-600">EXT</span>}
                                            </span>
                                        </td>
                                        {daysInMonth.map((day) => {
                                            const dateStr = cronoCompareDateKey(day);
                                            const key = `${emp.id}_${dateStr}`;
                                            const shift = resolveCommittedShiftAtObjective(emp.id, dateStr, objectiveId, shiftsMap);
                                            const absence = absencesMap[key];
                                            let content: React.ReactNode = null;
                                            let style = 'bg-white dark:bg-slate-800 text-slate-300 border border-slate-100 dark:border-slate-700';
                                            if (shift) {
                                                if (shift.isFrancoTrabajado) { content = 'FT'; style = CRONO_COMPARE_SHIFT_STYLES.FT; }
                                                else if (shift.isFrancoCompensatorio) { content = 'FF'; style = CRONO_COMPARE_SHIFT_STYLES.FF; }
                                                else {
                                                    content = shift.code || shift.type;
                                                    style = CRONO_COMPARE_SHIFT_STYLES[String(content).toUpperCase()] || 'bg-slate-100 text-slate-600 border border-slate-200 font-bold';
                                                }
                                            } else if (absence) {
                                                const abs = inferAbsenceCellStyle(absence);
                                                content = abs.content;
                                                style = abs.style;
                                            }
                                            const isWeekend = [0, 6].includes(day.getDay());
                                            return (
                                                <td key={key} className={`border-b border-r p-0.5 text-center ${isWeekend ? 'bg-rose-50/50 dark:bg-rose-950/10' : ''}`}>
                                                    <div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black ${style}`}>
                                                        {content}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
