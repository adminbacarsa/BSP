import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Maximize2, Minimize2, Users, X,
} from 'lucide-react';
import {
    CRONO_COMPARE_SHIFT_STYLES,
    cronoCompareDateKey,
    cronoCompareDayLetter,
    inferAbsenceCellStyle,
    resolveCommittedShiftAtObjective,
} from '@/lib/planificacion/cronoCompareUtils';
import {
    CANAL_ORDEN,
    armarFilasVentana,
    armarPortapapeles,
    columnasCrono,
    guardarPortapapeles,
    hhmmCrono,
    keyOrden,
    leerOrdenMeta,
    type FuenteTurno,
} from '@/lib/planificacion/cronoVentana';

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

type Punto = { r: number; c: number };

function fuenteDeCelda(shift: any, absence: any): FuenteTurno | null {
    if (shift) {
        const code = String(
            shift.isFrancoTrabajado ? 'FT' : shift.isFrancoCompensatorio ? 'FF' : (shift.code || shift.type || ''),
        ).trim().toUpperCase();
        if (!code) return null;
        return {
            code,
            name: shift.name || shift.type,
            positionName: shift.positionName,
            startTime: hhmmCrono(shift.startTime),
            endTime: hhmmCrono(shift.endTime),
            hours: Number(shift.hours) || undefined,
        };
    }
    if (!absence) return null;
    const abs = inferAbsenceCellStyle(absence);
    const code = String(abs.content || '').trim().toUpperCase();
    return code ? { code } : null;
}

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
    const [alineacion, setAlineacion] = useState<'mes' | 'semana'>('mes');
    const [verSinTurno, setVerSinTurno] = useState(false);
    const [ordenIds, setOrdenIds] = useState<string[]>([]);
    const [mesPrincipal, setMesPrincipal] = useState('');
    const [sel, setSel] = useState<{ a: Punto; b: Punto } | null>(null);
    const [avisoCopia, setAvisoCopia] = useState('');
    const drag = useRef(false);

    const daysInMonth = useMemo(() => {
        const d = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const days: Date[] = [];
        while (d.getMonth() === monthDate.getMonth()) {
            days.push(new Date(d));
            d.setDate(d.getDate() + 1);
        }
        return days;
    }, [monthDate]);

    useEffect(() => {
        const aplicar = () => {
            const meta = leerOrdenMeta(mainObjectiveId);
            setOrdenIds(meta.ids);
            setMesPrincipal(meta.month);
        };
        aplicar();
        let ch: BroadcastChannel | null = null;
        try {
            ch = new BroadcastChannel(CANAL_ORDEN);
            ch.onmessage = (ev) => {
                const data = ev.data as { main?: string; ids?: string[]; month?: string };
                if (data?.main && data.main === mainObjectiveId && Array.isArray(data.ids)) {
                    setOrdenIds(data.ids.map(String));
                    setMesPrincipal(String(data.month || ''));
                }
            };
        } catch { /* sin canal */ }
        const onStorage = (ev: StorageEvent) => {
            if (ev.key === keyOrden(mainObjectiveId)) aplicar();
        };
        window.addEventListener('storage', onStorage);
        return () => {
            ch?.close();
            window.removeEventListener('storage', onStorage);
        };
    }, [mainObjectiveId]);

    useEffect(() => {
        const up = () => { drag.current = false; };
        window.addEventListener('mouseup', up);
        return () => window.removeEventListener('mouseup', up);
    }, []);

    const tieneTurno = (id: string) => daysInMonth.some((d) => (
        resolveCommittedShiftAtObjective(id, cronoCompareDateKey(d), objectiveId, shiftsMap)
    ));

    const { conTurno, sinTurno } = useMemo(
        () => armarFilasVentana(ordenIds, employees.filter((e) => e.status !== 'inactivo'), tieneTurno),
        // tieneTurno cierra sobre el mes y el mapa; se recalcula con esas deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ordenIds, employees, objectiveId, shiftsMap, daysInMonth],
    );

    const filas = verSinTurno ? [...conTurno, ...sinTurno] : conTurno;
    const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const anclaDow = useMemo(() => {
        if (alineacion !== 'semana' || !mesPrincipal || mesPrincipal === monthKey) return undefined;
        const [y, m] = mesPrincipal.split('-').map(Number);
        if (!y || !m) return undefined;
        return new Date(y, m - 1, 1).getDay();
    }, [alineacion, mesPrincipal, monthKey]);
    const columnas = useMemo(() => columnasCrono(daysInMonth, alineacion, anclaDow), [daysInMonth, alineacion, anclaDow]);
    const indiceDia = useMemo(() => {
        const map = new Map<string, number>();
        daysInMonth.forEach((d, i) => map.set(cronoCompareDateKey(d), i));
        return map;
    }, [daysInMonth]);

    const rango = sel ? {
        minR: Math.min(sel.a.r, sel.b.r),
        maxR: Math.max(sel.a.r, sel.b.r),
        minC: Math.min(sel.a.c, sel.b.c),
        maxC: Math.max(sel.a.c, sel.b.c),
    } : null;

    const marcada = (r: number, c: number) => !!rango && r >= rango.minR && r <= rango.maxR && c >= rango.minC && c <= rango.maxC;

    const empezar = (r: number, c: number, shift: boolean) => {
        drag.current = true;
        setSel((prev) => (shift && prev ? { a: prev.a, b: { r, c } } : { a: { r, c }, b: { r, c } }));
    };
    const extender = (r: number, c: number) => {
        if (!drag.current) return;
        setSel((prev) => (prev ? { a: prev.a, b: { r, c } } : prev));
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c' || !rango) return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            const incluyeNombres = rango.minC < 0;
            const desde = Math.max(0, rango.minC);
            const filasCopia = [];
            for (let r = rango.minR; r <= rango.maxR; r++) {
                const emp = filas[r];
                if (!emp) continue;
                const celdas = [];
                for (let c = desde; c <= rango.maxC; c++) {
                    const day = daysInMonth[c];
                    if (!day) { celdas.push(null); continue; }
                    const dateStr = cronoCompareDateKey(day);
                    const shift = resolveCommittedShiftAtObjective(emp.id, dateStr, objectiveId, shiftsMap);
                    celdas.push(fuenteDeCelda(shift, absencesMap[`${emp.id}_${dateStr}`]));
                }
                filasCopia.push({ nombre: String(emp.name || emp.id), celdas });
            }
            if (!filasCopia.length) return;
            const port = armarPortapapeles({ filas: filasCopia, incluyeNombres });
            guardarPortapapeles(port);
            void navigator.clipboard?.writeText(port.tsv).catch(() => undefined);
            setAvisoCopia(incluyeNombres
                ? 'Copiado con nombres. En el cronograma, Ctrl+V lo pega alineado por guardia.'
                : 'Copiado. En el cronograma, Ctrl+V lo pega desde la celda activa.');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [rango, filas, daysInMonth, objectiveId, shiftsMap, absencesMap]);

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

    useEffect(() => {
        const onFs = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFs);
        return () => document.removeEventListener('fullscreenchange', onFs);
    }, []);

    const textoSin = `${sinTurno.length} sin turno en este mes`;

    return (
        <div className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-950" data-ventana-externa="1" data-alineacion={alineacion}>
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
                <div className="flex items-center bg-slate-800 rounded-lg p-0.5 shrink-0" data-alineacion-selector="1">
                    <button
                        type="button"
                        data-alineacion-opcion="mes"
                        onClick={() => setAlineacion('mes')}
                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase ${alineacion === 'mes' ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-700'}`}
                    >
                        Día del mes
                    </button>
                    <button
                        type="button"
                        data-alineacion-opcion="semana"
                        onClick={() => setAlineacion('semana')}
                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase ${alineacion === 'semana' ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-slate-700'}`}
                    >
                        Día de la semana
                    </button>
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
                Solo lectura · seleccioná celdas (clic, Mayús o arrastre) y Ctrl+C copia código, puesto y horario.
                Si incluís el nombre, el pegado se alinea por guardia.
                {avisoCopia ? <span className="ml-2 text-emerald-700" data-copia-aviso="1">{avisoCopia}</span> : null}
            </div>

            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-slate-50 dark:bg-slate-950">
                {!objectiveId ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400 p-6 text-center">
                        <Users size={28} className="opacity-40" />
                        <p className="text-sm font-bold">Elegí un objetivo para ver su cronograma</p>
                    </div>
                ) : !mainObjectiveId ? (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm p-6">Abrí esta ventana desde el cronograma en el que estás trabajando.</div>
                ) : ordenIds.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm p-6 text-center" data-ventana-esperando="1">Esperando el orden del cronograma principal.</div>
                ) : conTurno.length === 0 && sinTurno.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-400 text-sm p-6">Nadie de ese cronograma está en este objetivo.</div>
                ) : (
                    <table className="border-separate border-spacing-0 w-full text-xs min-w-max" data-ventana-grilla="1">
                        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 shadow-sm">
                            <tr>
                                <th className="sticky left-0 z-20 bg-slate-100 dark:bg-slate-800 p-2 text-left border-b border-r min-w-[140px] max-w-[200px]">
                                    <span className="text-[10px] font-black uppercase text-slate-500"><Users size={11} className="inline mr-1" />Dotación</span>
                                    <span className="block text-[8px] font-bold text-slate-400" data-ventana-con-turno={conTurno.length}>{conTurno.length} con turno</span>
                                </th>
                                {columnas.map((col, i) => {
                                    if (!col.date) {
                                        return <th key={`vacio-${i}`} className="min-w-[26px] border-b border-r p-0.5 bg-slate-50" />;
                                    }
                                    const dateStr = cronoCompareDateKey(col.date);
                                    const isWeekend = [0, 6].includes(col.date.getDay());
                                    return (
                                        <th key={dateStr} className={`min-w-[26px] border-b border-r p-0.5 text-center ${isWeekend ? 'bg-rose-50 dark:bg-rose-950/30' : ''}`}>
                                            <div className="text-[8px] font-black text-slate-400">{cronoCompareDayLetter(dateStr)}</div>
                                            <div className={`text-[10px] font-bold ${isWeekend ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>{col.date.getDate()}</div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {filas.map((emp, r) => {
                                const esSin = sinTurno.some((s) => s.id === emp.id);
                                const isGuest = emp.preferredObjectiveId !== objectiveId && slaIdToObjId[emp.preferredObjectiveId] !== objectiveId;
                                return (
                                    <tr key={emp.id} className="hover:bg-white/80 dark:hover:bg-slate-800/50" data-ventana-fila={emp.id} data-sin-turno={esSin ? '1' : '0'}>
                                        <td
                                            className={`sticky left-0 z-10 border-r border-b p-1.5 max-w-[200px] cursor-cell ${marcada(r, -1) ? 'bg-indigo-100 ring-2 ring-inset ring-indigo-500' : 'bg-white dark:bg-slate-900'}`}
                                            onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); empezar(r, -1, e.shiftKey); }}
                                            onMouseEnter={() => extender(r, -1)}
                                        >
                                            <span className="text-[9px] font-bold truncate block text-slate-700 dark:text-slate-200" title={emp.name}>
                                                {emp.name}
                                                {isGuest && <span className="ml-1 text-[7px] font-black text-amber-600">EXT</span>}
                                            </span>
                                        </td>
                                        {columnas.map((col, i) => {
                                            if (!col.date) return <td key={`vacio-${emp.id}-${i}`} className="border-b border-r bg-slate-50/80" />;
                                            const dateStr = cronoCompareDateKey(col.date);
                                            const c = indiceDia.get(dateStr) ?? -1;
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
                                            const isWeekend = [0, 6].includes(col.date.getDay());
                                            const on = marcada(r, c);
                                            return (
                                                <td
                                                    key={key}
                                                    data-ventana-celda={`${r}:${c}`}
                                                    data-seleccionada={on ? '1' : '0'}
                                                    className={`border-b border-r p-0.5 text-center cursor-cell ${isWeekend ? 'bg-rose-50/50 dark:bg-rose-950/10' : ''} ${on ? 'ring-2 ring-inset ring-indigo-500' : ''}`}
                                                    onMouseDown={(e) => { if (e.button !== 0) return; e.preventDefault(); empezar(r, c, e.shiftKey); }}
                                                    onMouseEnter={() => extender(r, c)}
                                                >
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
                {objectiveId && sinTurno.length > 0 && (
                    <button
                        type="button"
                        data-sin-turno-toggle="1"
                        onClick={() => { setVerSinTurno((v) => !v); setSel(null); }}
                        className="m-3 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-600 shadow-sm hover:bg-slate-50"
                    >
                        {verSinTurno ? 'Ocultar' : 'Ver'} {textoSin}
                    </button>
                )}
            </div>
        </div>
    );
}
