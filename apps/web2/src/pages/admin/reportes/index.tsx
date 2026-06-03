import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
    Users, Building, Download, Printer,
    Calendar, User, X, ChevronRight, Sun, Moon, BarChart3, FileText, CalendarDays
} from 'lucide-react';
import { PageShell, PageHeader, TabBar, ContentCard } from '@/components/ui';
import { db } from '@/lib/firebase'; // Necesario para el log de descarga
import { getAuth } from 'firebase/auth'; 
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useReportes, resolveShiftDurationHours, dedupeShiftsByAbsencePriority, mapAbsenceStatusLabel, LEAVE_REPORT_CODES, isReportVacancyShift, buildPayrollExportPayload, shouldBillShiftToObjective, type ReportPublishFilter } from '@/hooks/useReportes';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

// --- ESTILOS DE IMPRESIÓN (MANTENIDOS) ---
const PrintStyles = () => (
    <style>{`
        @media print {
            @page { margin: 0.5cm; size: landscape; }
            body { background: white !important; -webkit-print-color-adjust: exact; font-family: sans-serif; }
            .no-print, nav, aside, button, .dashboard-header { display: none !important; }
            .print-only { display: block !important; }
            .print-container { width: 100%; margin: 0; padding: 0; box-shadow: none !important; border: none !important; }
            table { width: 100%; border-collapse: collapse; font-size: 8pt; }
            th, td { border: 1px solid #ccc; padding: 4px; text-align: center; }
            th { background-color: #f3f4f6 !important; color: #000 !important; font-weight: bold; }
            .text-indigo-600, .text-emerald-400, .text-rose-400 { color: #000 !important; }
        }
        .print-only { display: none; }
    `}</style>
);

// Helpers visuales
const formatTime = (dateInput: any) => {
    const d = dateInput?.seconds ? new Date(dateInput.seconds * 1000) : new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (dateInput: any) => {
    const d = dateInput?.seconds ? new Date(dateInput.seconds * 1000) : new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
};

const getNightDuration = (start: Date, end: Date) => {
    // Reutilizamos lógica visual simple si se necesita en render,
    // pero los datos ya vienen calculados del hook.
    let durationMins = 0;
    let current = new Date(start.getTime());
    const endTime = end.getTime();
    while (current.getTime() < endTime) {
        const h = current.getHours();
        if (h >= 21 || h < 6) durationMins++;
        current.setMinutes(current.getMinutes() + 1);
    }
    return durationMins / 60;
};

const DICTIONARY: Record<string, string> = {
    'MANUAL_CHECKIN': 'Fichada Manual', 'CHECKIN': 'Entrada', 'CHECKOUT': 'Salida',
    'ASIGNACION_TURNO': 'Asignación', 'ELIMINACION_TURNO': 'Eliminación',
    'CAMBIO_DOTACION': 'Cambio Dotación', 'ALTA_EMPLEADO': 'Alta Empleado',
    'BAJA_EMPLEADO': 'Baja Empleado', 'EDICION_CLIENTE': 'Edición Cliente',
    'AUTORIZACION_EXCEPCION': 'Excepción', 'ASIGNACION_MASIVA': 'Carga Masiva',
    'CAMBIO_FRANCO_TURNO': 'Franco Trab. (FT)', 'CAMBIO_DIAGRAMA': 'Enroque',
    'CAMBIO_TURNO_FRANCO': 'Devolución (FF)'
};

export default function ReportsPage() {
    const { assignedClientId } = useAuth();
    const { empresaId } = useEmpresa();
    const {
        loading, dateRange, setDateRange, publishFilter, setPublishFilter,
        generateReports, loadAudit,
        employeeReport, objectiveReport, auditLogs,
        objMap, empMap, holidaysData, SHIFT_HOURS_LOOKUP, OPERATIVE_CODES
    } = useReportes(assignedClientId);

    const [empSortBy, setEmpSortBy] = useState<'name' | 'legajo'>('name');

    const [activeTab, setActiveTab] = useState<'EMPLOYEE' | 'OBJECTIVE' | 'AUDIT' | 'SHIFTS' | 'PLANIFICADO'>('EMPLOYEE');
    const [selectedDetailEmployee, setSelectedDetailEmployee] = useState<string>('');
    const [shiftsFilterTimeFrom, setShiftsFilterTimeFrom] = useState('');
    const [shiftsFilterTimeTo, setShiftsFilterTimeTo] = useState('');
    const [shiftsFilterObjective, setShiftsFilterObjective] = useState('');
    const [shiftsFilterStatus, setShiftsFilterStatus] = useState('');
    const [detailItem, setDetailItem] = useState<any | null>(null);
    const [detailFilterTimeFrom, setDetailFilterTimeFrom] = useState('');
    const [detailFilterTimeTo, setDetailFilterTimeTo] = useState('');
    const [detailFilterEmployee, setDetailFilterEmployee] = useState('');
    const [detailFilterObjective, setDetailFilterObjective] = useState('');
    const [detailFilterStatus, setDetailFilterStatus] = useState('');
    const [leavePopoverId, setLeavePopoverId] = useState<string | null>(null);
    const [currentUserName, setCurrentUserName] = useState("Cargando...");
    const [expandedObjective, setExpandedObjective] = useState<string | null>(null);
    const [objFilterClient, setObjFilterClient] = useState<string>('');
    const [objFilterName, setObjFilterName] = useState<string>('');
    const [planFilterObjective, setPlanFilterObjective] = useState<string>('');
    const [planFilterEmployee, setPlanFilterEmployee] = useState<string>('');
    const [planFilterDate, setPlanFilterDate] = useState<string>('');
    const [auditFilterActor, setAuditFilterActor] = useState<string>('');

    useEffect(() => {
        const auth = getAuth();
        if (auth.currentUser) setCurrentUserName(auth.currentUser.displayName || auth.currentUser.email || "Usuario");
    }, []);

    const sortedEmployeeReport = useMemo(() => {
        const list = [...employeeReport];
        if (empSortBy === 'legajo') {
            list.sort((a, b) => {
                const la = String(a.legajo || '').trim();
                const lb = String(b.legajo || '').trim();
                if (!la && !lb) return a.name.localeCompare(b.name);
                if (!la) return 1;
                if (!lb) return -1;
                const na = /^\d+$/.test(la) && /^\d+$/.test(lb) ? Number(la) - Number(lb) : la.localeCompare(lb, 'es', { numeric: true });
                if (na !== 0) return na;
                return a.name.localeCompare(b.name);
            });
        } else {
            list.sort((a, b) => a.name.localeCompare(b.name));
        }
        return list;
    }, [employeeReport, empSortBy]);

    const downloadPayrollJson = () => {
        const rows = sortedEmployeeReport;
        if (!rows.length) {
            toast.error('Generá el reporte antes de exportar JSON.');
            return;
        }
        const payload = buildPayrollExportPayload(rows, {
            start: dateRange.start,
            end: dateRange.end,
            empresaId: empresaId || undefined,
            publishFilter,
        });
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `liquidacion_${dateRange.start}_${dateRange.end}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        const vacDias = rows.reduce((n, r) => n + (r.novedadesRRHH?.vacacionesDias || 0), 0);
        toast.success(`JSON exportado · ${rows.length} empleado(s)${vacDias ? ` · ${vacDias} días vacaciones` : ''}`);
    };

    // Función de descarga CSV (Mantenida local porque usa interacción con DOM)
    const downloadCSV = async (data: any[], filename: string) => {
        if (!data.length) return;
        const auth = getAuth();
        const u = auth.currentUser;
        await addDoc(collection(db, 'audit_logs'), { timestamp: serverTimestamp(), actorUid: u?.uid || 'system', actorName: currentUserName, action: 'EXPORT_REPORT', module: 'REPORTES', details: `Exportó ${filename}.csv` });

        const rows = data.map(obj => {
            const { rawShifts, type, id, clientId, ...rest } = obj; 
            return Object.values(rest).join(',');
        }).join('\n');
        const headers = Object.keys(data[0]).filter(k => !['rawShifts','type','id','clientId'].includes(k)).join(',');
        const blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.csv`;
        a.click();
    };

    // --- RENDERIZADO TABLA OBJETIVOS ---
    const renderObjectiveTable = () => {
        const allClients = [...new Set(objectiveReport.map(r => r.client))].sort();
        const filtered = objectiveReport.filter(row => {
            if (objFilterClient && row.client !== objFilterClient) return false;
            if (objFilterName && !row.name.toLowerCase().includes(objFilterName.toLowerCase())) return false;
            return true;
        });
        const groupedByClient: any = {};
        filtered.forEach(row => {
            if (!groupedByClient[row.client]) groupedByClient[row.client] = [];
            groupedByClient[row.client].push(row);
        });

        const grandTotal = filtered.reduce((acc, curr) => {
            const vendidas = curr.vendidas || 0;
            const hsVacantes = vendidas > 0 ? Math.max(0, vendidas - curr.total) : (curr.vacantHours || 0);
            return {
                shifts: acc.shifts + curr.shifts,
                vacantShifts: acc.vacantShifts + (curr.vacantShifts || 0),
                vacantHours: acc.vacantHours + hsVacantes,
                vendidas: acc.vendidas + vendidas,
                total: acc.total + curr.total,
                diurnas: acc.diurnas + curr.diurnas,
                nocturnas: acc.nocturnas + curr.nocturnas,
                extra100: acc.extra100 + curr.extra100,
                plusFeriado: acc.plusFeriado + curr.plusFeriado
            };
        }, { shifts: 0, vacantShifts: 0, vacantHours: 0, vendidas: 0, total: 0, diurnas: 0, nocturnas: 0, extra100: 0, plusFeriado: 0 });

        return (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden print-container">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap gap-3 items-center bg-slate-50 dark:bg-slate-700/50 no-print">
                    <h3 className="font-black text-sm uppercase flex gap-2 text-slate-800 dark:text-white flex-1 min-w-[150px]"><Building size={16}/> Costos por Objetivo</h3>
                    <select
                        value={objFilterClient}
                        onChange={e => setObjFilterClient(e.target.value)}
                        className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 bg-white min-w-[160px]"
                    >
                        <option value="">Todos los clientes</option>
                        {allClients.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                        type="text"
                        placeholder="Buscar objetivo..."
                        value={objFilterName}
                        onChange={e => setObjFilterName(e.target.value)}
                        className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 bg-white min-w-[160px]"
                    />
                    <div className="flex gap-2">
                        <button onClick={() => downloadCSV(filtered, 'reporte_objetivos')} aria-label="Descargar CSV de objetivos" className="p-2 bg-white border rounded hover:bg-slate-100 text-slate-500"><Download size={16} aria-hidden="true"/></button>
                        <button onClick={() => window.print()} aria-label="Imprimir reporte de objetivos" className="p-2 bg-white border rounded hover:bg-slate-100 text-slate-500"><Printer size={16} aria-hidden="true"/></button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                            <tr>
                                <th className="p-4">Objetivo</th>
                                <th className="p-4 text-center text-teal-600">Hs. Vendidas</th>
                                <th className="p-4 text-center">Turnos</th>
                                <th className="p-4 text-center text-indigo-600">Total Hs</th>
                                <th className="p-4 text-center">Diurnas</th>
                                <th className="p-4 text-center">Noct.</th>
                                <th className="p-4 text-center text-rose-600">Ex 100%</th>
                                <th className="p-4 text-center text-emerald-600">Feriado</th>
                                <th className="p-4 text-center text-amber-600">Hs Vacantes</th>
                                <th className="p-4 w-8 no-print"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {Object.keys(groupedByClient).map(clientName => {
                                const rows = groupedByClient[clientName];
                                return (
                                    <React.Fragment key={clientName}>
                                        <tr className="bg-slate-100/50 border-b border-slate-200">
                                            <td colSpan={10} className="px-4 py-2 font-black text-xs text-slate-500 uppercase tracking-wider">{clientName}</td>
                                        </tr>
                                        {rows.map((row: any) => {
                                            const isOpen = expandedObjective === row.id;
                                            return (
                                                <React.Fragment key={row.id}>
                                                    <tr
                                                        className="hover:bg-indigo-50/30 cursor-pointer"
                                                        onClick={() => setExpandedObjective(isOpen ? null : row.id)}
                                                    >
                                                        <td className="p-4 pl-8 text-slate-700 font-bold">{row.name}</td>
                                                        <td className="p-4 text-center font-black text-teal-600">
                                                            {(row.vendidas || 0) > 0
                                                                ? <span>{row.vendidas.toFixed(1)}<span className="text-[9px] font-normal text-teal-400 ml-0.5">/mes</span></span>
                                                                : <span className="text-slate-300">—</span>}
                                                        </td>
                                                        <td className="p-4 text-center">{row.shifts}</td>
                                                        <td className="p-4 text-center font-black text-indigo-600">{row.total.toFixed(1)}</td>
                                                        <td className="p-4 text-center text-slate-500">{row.diurnas.toFixed(1)}</td>
                                                        <td className="p-4 text-center text-slate-500">{row.nocturnas.toFixed(1)}</td>
                                                        <td className="p-4 text-center font-bold text-rose-600">{row.extra100.toFixed(1)}</td>
                                                        <td className="p-4 text-center font-bold text-emerald-600">{row.plusFeriado.toFixed(1)}</td>
                                                        <td className="p-4 text-center font-bold text-amber-600">
                                                            {(() => {
                                                                const vendidas = row.vendidas || 0;
                                                                const hsVac = vendidas > 0
                                                                    ? Math.max(0, vendidas - row.total)
                                                                    : (row.vacantHours || 0);
                                                                if (hsVac <= 0) return <span className="text-slate-300">—</span>;
                                                                return (
                                                                    <span>
                                                                        {hsVac.toFixed(1)}
                                                                        {vendidas > 0
                                                                            ? <span className="text-[9px] font-normal text-amber-400 ml-0.5">hs</span>
                                                                            : <span className="text-[9px] font-normal text-amber-400"> ({row.vacantShifts}t)</span>}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="p-4 text-center text-slate-400 no-print">
                                                            <ChevronRight size={15} className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}/>
                                                        </td>
                                                    </tr>
                                                    {isOpen && (
                                                        <tr>
                                                            <td colSpan={9} className="bg-slate-50 px-6 py-3 border-b border-slate-200">
                                                                <table className="w-full text-xs text-left border-collapse">
                                                                    <thead>
                                                                        <tr className="text-[9px] uppercase font-black text-slate-400 border-b border-slate-200">
                                                                            <th className="py-1.5 pr-3">Fecha</th>
                                                                            <th className="py-1.5 pr-3">Empleado</th>
                                                                            <th className="py-1.5 pr-3">Cód.</th>
                                                                            <th className="py-1.5 pr-3">Planificado</th>
                                                                            <th className="py-1.5 pr-3">Real</th>
                                                                            <th className="py-1.5 pr-3 text-right">Hs Teóricas</th>
                                                                            <th className="py-1.5 pr-3 text-right text-indigo-600">Hs Reales</th>
                                                                            <th className="py-1.5 text-right">Noct.</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100">
                                                                        {[...(row.rawShifts || [])].sort((a: any, b: any) => (a.startTime?.seconds || 0) - (b.startTime?.seconds || 0)).map((s: any) => {
                                                                            const start = s.startTime?.seconds ? new Date(s.startTime.seconds * 1000) : null;
                                                                            const end = s.endTime?.seconds ? new Date(s.endTime.seconds * 1000) : null;
                                                                            const dur = resolveShiftDurationHours(s, SHIFT_HOURS_LOOKUP, { forObjectiveBilling: true });
                                                                            const night = start && end ? getNightDuration(start, end) : 0;
                                                                            const isVacant = isReportVacancyShift(s, empMap);
                                                                            const rStart = s.realStartTime?.seconds ? new Date(s.realStartTime.seconds*1000) : s.checkInTime?.seconds ? new Date(s.checkInTime.seconds*1000) : null;
                                                                            const rEnd   = s.realEndTime?.seconds   ? new Date(s.realEndTime.seconds*1000)   : s.checkOutTime?.seconds ? new Date(s.checkOutTime.seconds*1000) : null;
                                                                            const rDur   = rStart && rEnd ? Math.min(36, Math.max(0, (rEnd.getTime()-rStart.getTime())/3600000)) : null;
                                                                            const hasOvertime = rDur != null && rDur > dur + 0.1;
                                                                            const fmt = (d: Date) => d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
                                                                            return (
                                                                                <tr key={s.id} className={isVacant ? 'bg-amber-50/60' : hasOvertime ? 'bg-orange-50/40' : ''}>
                                                                                    <td className="py-1.5 pr-3 text-slate-600">{start ? start.toLocaleDateString('es-AR') : '-'}</td>
                                                                                    <td className={`py-1.5 pr-3 font-bold ${isVacant ? 'text-amber-600 italic' : 'text-slate-700'}`}>{s.employeeName || 'Vacante'}</td>
                                                                                    <td className="py-1.5 pr-3 text-slate-500">{s.code || '-'}</td>
                                                                                    <td className="py-1.5 pr-3 text-slate-500 text-[10px]">
                                                                                        {start && end ? `${fmt(start)}–${fmt(end)}` : '-'}
                                                                                    </td>
                                                                                    <td className="py-1.5 pr-3 text-[10px]">
                                                                                        {rStart && rEnd
                                                                                            ? <span className={hasOvertime ? 'text-orange-600 font-bold' : 'text-slate-500'}>{fmt(rStart)}–{fmt(rEnd)}</span>
                                                                                            : <span className="text-slate-300">—</span>}
                                                                                    </td>
                                                                                    <td className="py-1.5 pr-3 text-right text-slate-400 text-[10px]">{dur.toFixed(1)}</td>
                                                                                    <td className={`py-1.5 pr-3 text-right font-bold text-[10px] ${isVacant ? 'text-amber-500' : hasOvertime ? 'text-orange-600' : 'text-indigo-600'}`}>
                                                                                        {rDur != null ? rDur.toFixed(1) : dur.toFixed(1)}
                                                                                        {hasOvertime && <span className="text-[9px] ml-1 text-orange-400">+{(rDur!-dur).toFixed(1)}</span>}
                                                                                    </td>
                                                                                    <td className="py-1.5 text-right text-slate-500 text-[10px]">{night.toFixed(1)}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-slate-900 text-white font-black text-xs uppercase print:bg-gray-200 print:text-black">
                            <tr>
                                <td className="p-4 text-right">TOTAL GENERAL</td>
                                <td className="p-4 text-center text-teal-400 print:text-black">{grandTotal.vendidas > 0 ? grandTotal.vendidas.toFixed(1) : '—'}</td>
                                <td className="p-4 text-center">{grandTotal.shifts}</td>
                                <td className="p-4 text-center text-emerald-400 print:text-black">{grandTotal.total.toFixed(1)}</td>
                                <td className="p-4 text-center">{grandTotal.diurnas.toFixed(1)}</td>
                                <td className="p-4 text-center text-violet-300 print:text-black">{grandTotal.nocturnas.toFixed(1)}</td>
                                <td className="p-4 text-center text-rose-400 print:text-black">{grandTotal.extra100.toFixed(1)}</td>
                                <td className="p-4 text-center text-emerald-400 print:text-black">{grandTotal.plusFeriado.toFixed(1)}</td>
                                <td className="p-4 text-center text-amber-400 print:text-black">{grandTotal.vacantHours.toFixed(1)}</td>
                                <td className="no-print"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    };

    const renderEmployeeTable = () => {
        const rows = sortedEmployeeReport;
        const grandTotal = employeeReport.reduce((acc, curr) => ({
            shifts: acc.shifts + curr.shifts,
            total: acc.total + curr.total,
            horasReales: acc.horasReales + (curr.horasReales || curr.total),
            horasExtra: acc.horasExtra + (curr.horasExtra || 0),
            diurnas: acc.diurnas + curr.diurnas,
            nocturnas: acc.nocturnas + curr.nocturnas,
            extra50: acc.extra50 + curr.extra50,
            extra100: acc.extra100 + curr.extra100,
            plusFeriado: acc.plusFeriado + curr.plusFeriado
        }), { shifts: 0, total: 0, horasReales: 0, horasExtra: 0, diurnas: 0, nocturnas: 0, extra50: 0, extra100: 0, plusFeriado: 0 });

        return (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden print-container">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap justify-between items-center gap-3 bg-slate-50 dark:bg-slate-700/50 no-print">
                    <div>
                        <h3 className="font-black text-sm uppercase flex gap-2 text-slate-800 dark:text-white"><Users size={16}/> Liquidación de Horas</h3>
                        <p className="text-[10px] text-slate-400 mt-1">
                            Filtro: {publishFilter === 'published' ? 'Solo cronos publicados' : publishFilter === 'unpublished' ? 'Solo borradores / no publicados' : 'Todos los turnos (publicados y borrador)'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                        <select
                            value={empSortBy}
                            onChange={e => setEmpSortBy(e.target.value as 'name' | 'legajo')}
                            className="px-2 py-1.5 border rounded-lg text-xs font-bold text-slate-600 bg-white"
                            title="Orden de la grilla"
                        >
                            <option value="name">Orden: Apellido</option>
                            <option value="legajo">Orden: Legajo</option>
                        </select>
                        <button onClick={() => downloadCSV(rows, 'reporte_empleados')} aria-label="Descargar CSV de empleados" className="p-2 bg-white border rounded hover:bg-slate-100 text-slate-500"><Download size={16} aria-hidden="true"/></button>
                        <button type="button" onClick={downloadPayrollJson} title="Exportar JSON (integración payrollApi)" aria-label="Exportar JSON liquidación" className="px-2.5 py-2 bg-white border rounded hover:bg-indigo-50 text-indigo-600 flex items-center gap-1 text-[10px] font-black uppercase"><FileText size={14} aria-hidden="true"/> JSON</button>
                        <button onClick={() => window.print()} aria-label="Imprimir liquidación de horas" className="p-2 bg-white border rounded hover:bg-slate-100 text-slate-500"><Printer size={16} aria-hidden="true"/></button>
                    </div>
                </div>
                <div className="px-4 pt-3 pb-1 flex flex-wrap gap-x-4 gap-y-1 no-print" aria-label="Referencias de columnas">
                    {[
                        { color: 'bg-amber-400',  label: 'Diurnas' },
                        { color: 'bg-violet-500', label: 'Nocturnas' },
                        { color: 'bg-orange-400', label: 'Al 50%' },
                        { color: 'bg-rose-500',   label: 'Al 100% (Feriado trabajado)' },
                        { color: 'bg-emerald-500',label: 'Plus Feriado' },
                    ].map(({ color, label }) => (
                        <span key={label} className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                            <span className={`w-2.5 h-2.5 rounded-sm ${color} flex-shrink-0`} aria-hidden="true"/>
                            {label}
                        </span>
                    ))}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                            <tr>
                                <th className="p-4">Legajo</th>
                                <th className="p-4">Empleado</th>
                                <th className="p-4 text-center">Turnos</th>
                                <th className="p-4 text-center text-slate-400">Hs. Teóricas</th>
                                <th className="p-4 text-center text-indigo-600">Hs. Reales</th>
                                <th className="p-4 text-center text-amber-500">Diurnas</th>
                                <th className="p-4 text-center text-violet-600">Nocturnas</th>
                                <th className="p-4 text-center text-orange-500">Al 50%</th>
                                <th className="p-4 text-center text-rose-600">Al 100% (FT)</th>
                                <th className="p-4 text-center text-emerald-600">Plus Feriado</th>
                                <th className="p-4 text-center no-print">Ver</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {rows.map(row => {
                                const horasReales = row.horasReales ?? row.total;
                                return (
                                <tr key={row.id} className="hover:bg-indigo-50/30 cursor-pointer group" onClick={() => { setDetailItem(row); setDetailFilterTimeFrom(''); setDetailFilterTimeTo(''); setDetailFilterEmployee(''); setDetailFilterObjective(''); setDetailFilterStatus(''); }}>
                                    <td className="p-4 font-mono text-xs text-slate-500">{row.legajo || '—'}</td>
                                    <td className="p-4 font-bold text-slate-700">
                                        {row.name}
                                        {(row.ftCount > 0 || row.ffCount > 0) && (
                                            <div className="flex gap-1 mt-1 flex-wrap">
                                                {row.ftCount > 0 && <span className="text-[9px] bg-violet-100 text-violet-700 px-1 rounded border border-violet-200">FT: {row.ftCount}</span>}
                                                {row.ffCount > 0 && <span className="text-[9px] bg-cyan-100 text-cyan-700 px-1 rounded border border-cyan-200">FF: {row.ffCount}</span>}
                                                {(row.novedadesRRHH?.vacacionesDias || 0) > 0 && (
                                                    <span className="text-[9px] bg-rose-100 text-rose-700 px-1 rounded border border-rose-200">Vac: {row.novedadesRRHH.vacacionesDias}d</span>
                                                )}
                                            </div>
                                        )}
                                        {!(row.ftCount > 0 || row.ffCount > 0) && (row.novedadesRRHH?.vacacionesDias || 0) > 0 && (
                                            <div className="flex gap-1 mt-1 flex-wrap">
                                                <span className="text-[9px] bg-rose-100 text-rose-700 px-1 rounded border border-rose-200">Vac: {row.novedadesRRHH.vacacionesDias}d</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-4 text-center">{row.shifts}</td>
                                    <td className="p-4 text-center text-slate-400">{row.total.toFixed(1)}</td>
                                    <td className="p-4 text-center font-black text-indigo-600 text-lg">{horasReales.toFixed(1)}</td>
                                    <td className="p-4 text-center font-bold text-amber-500">{row.diurnas.toFixed(1)}</td>
                                    <td className="p-4 text-center font-bold text-violet-600">{row.nocturnas.toFixed(1)}</td>
                                    <td className="p-4 text-center font-bold text-orange-500 bg-orange-50/30">{row.extra50 > 0 ? row.extra50.toFixed(1) : <span className="text-slate-300">—</span>}</td>
                                    <td className="p-4 text-center font-bold text-rose-600 bg-rose-50/30">{row.extra100 > 0 ? row.extra100.toFixed(1) : <span className="text-slate-300">—</span>}</td>
                                    <td className="p-4 text-center font-bold text-emerald-600">{row.plusFeriado > 0 ? row.plusFeriado.toFixed(1) : <span className="text-slate-300">—</span>}</td>
                                    <td className="p-4 text-center text-slate-300 group-hover:text-indigo-600 no-print"><ChevronRight size={16}/></td>
                                </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-slate-900 text-white font-black text-xs uppercase print:bg-gray-200 print:text-black">
                            <tr>
                                <td colSpan={2} className="p-4 text-right">TOTAL GENERAL</td>
                                <td className="p-4 text-center">{grandTotal.shifts}</td>
                                <td className="p-4 text-center text-slate-400 print:text-black">{grandTotal.total.toFixed(1)}</td>
                                <td className="p-4 text-center text-emerald-400 print:text-black">{grandTotal.horasReales.toFixed(1)}</td>
                                <td className="p-4 text-center text-amber-400 print:text-black">{grandTotal.diurnas.toFixed(1)}</td>
                                <td className="p-4 text-center text-violet-300 print:text-black">{grandTotal.nocturnas.toFixed(1)}</td>
                                <td className="p-4 text-center text-orange-400 print:text-black">{grandTotal.extra50.toFixed(1)}</td>
                                <td className="p-4 text-center text-rose-400 print:text-black">{grandTotal.extra100.toFixed(1)}</td>
                                <td className="p-4 text-center text-emerald-400 print:text-black">{grandTotal.plusFeriado.toFixed(1)}</td>
                                <td className="no-print"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    };

    const renderShiftsDetailTable = () => {
        if (!employeeReport.length) {
            return (
                <div className="p-10 text-center bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 animate-in fade-in">
                    <User size={48} className="mx-auto mb-2 opacity-20"/>
                    <p className="font-bold uppercase text-sm">Generá el reporte para ver los turnos</p>
                </div>
            );
        }

        // Aplanar todos los turnos de todos los empleados con nombre
        const allShiftsFlat: any[] = employeeReport.flatMap(emp =>
            (emp.rawShifts || []).map((s: any) => ({ ...s, _empName: emp.name, _empId: emp.id }))
        );

        // Aplicar filtros
        const filtered = allShiftsFlat
            .sort((a, b) => (a.startTime?.seconds||0) - (b.startTime?.seconds||0))
            .filter(s => {
                if (selectedDetailEmployee && s._empId !== selectedDetailEmployee) return false;
                if (shiftsFilterObjective) {
                    const on = s.objectiveName || objMap[s.objectiveId] || s.objectiveId || '';
                    if (on !== shiftsFilterObjective) return false;
                }
                if (shiftsFilterTimeFrom || shiftsFilterTimeTo) {
                    const d = new Date((s.startTime?.seconds || 0) * 1000);
                    const hhmm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    if (shiftsFilterTimeFrom && hhmm < shiftsFilterTimeFrom) return false;
                    if (shiftsFilterTimeTo && hhmm > shiftsFilterTimeTo) return false;
                }
                if (shiftsFilterStatus) {
                    const code = (s.code || '').trim().toUpperCase();
                    const PAID_LEAVE_F = new Set(['V','L','PG','E','A']);
                    const st = code === 'V' ? 'VACACIONES'
                        : code === 'L' ? 'LICENCIA'
                        : code === 'PG' ? 'PERM. GREMIAL'
                        : code === 'E' ? 'ENFERMEDAD'
                        : code === 'A' ? 'ART'
                        : code === 'AA' ? 'AUS. INJUST.'
                        : (code === 'F' || code === 'FF' || code === 'FP') ? 'FRANCO'
                        : (s.status === 'COMPLETED' || s.isCompleted) ? 'COMPLETADO'
                        : (s.status === 'PRESENT' || s.isPresent) ? 'PRESENTE'
                        : (!PAID_LEAVE_F.has(code) && (s.isAbsent || s.status === 'ABSENT')) ? 'AUSENTE'
                        : 'PENDIENTE';
                    if (st !== shiftsFilterStatus) return false;
                }
                return true;
            });

        const showEmpCol = !selectedDetailEmployee;
        const title = selectedDetailEmployee
            ? employeeReport.find(e => e.id === selectedDetailEmployee)?.name || 'Empleado'
            : 'Todos los empleados';

        return (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden print-container animate-in fade-in slide-in-from-bottom-4">
                <div className="p-4 border-b flex justify-between items-center bg-slate-50 no-print">
                    <h3 className="font-black text-sm uppercase flex gap-2 items-center">
                        <Calendar size={16} className="text-indigo-600"/>
                        Cronograma: <span className="text-slate-700">{title}</span>
                        <span className="text-[10px] font-normal text-slate-400">({filtered.length} turnos)</span>
                    </h3>
                    <button onClick={() => window.print()} aria-label="Imprimir cronograma" className="p-2 bg-white border rounded hover:bg-slate-100 text-slate-500"><Printer size={16} aria-hidden="true"/></button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                            <tr>
                                <th className="p-4">Fecha</th>
                                <th className="p-4">Día</th>
                                {showEmpCol && <th className="p-4">Empleado</th>}
                                <th className="p-4 text-center">Código</th>
                                <th className="p-4 text-center">Horario</th>
                                <th className="p-4">Objetivo</th>
                                <th className="p-4 text-center">Hs Calc.</th>
                                <th className="p-4 text-center">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {filtered.map((s: any) => {
                                const dateObj = new Date((s.startTime?.seconds||0) * 1000);
                                const dayName = dateObj.toLocaleDateString('es-AR', { weekday: 'long' });
                                const rawCode = (s.code || '').trim().toUpperCase();
                                // Francos e injustificada = 0 hs. Licencias/vacaciones/enfermedad/ART = sí computan.
                                const PAID_LEAVE    = new Set(['V','L','PG','E','A']);
                                const isUnjustAbsent = !PAID_LEAVE.has(rawCode) && (s.isAbsent || s.status === 'ABSENT');
                                const duration = resolveShiftDurationHours(s, SHIFT_HOURS_LOOKUP, { unjustifiedAbsent: isUnjustAbsent });
                                const isLicencia = ['L','PG'].includes(rawCode);
                                const codeStyle = rawCode === 'PG' ? 'bg-blue-100 text-blue-700 border-blue-300'
                                    : rawCode === 'RET' ? 'bg-amber-100 text-amber-800 border-amber-300'
                                    : ['L','V','A','E','AA'].includes(rawCode) ? 'bg-rose-50 text-rose-600 border-rose-200'
                                    : rawCode === 'F' ? 'bg-slate-100 text-slate-400 border-slate-200'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-100';
                                return (
                                    <tr key={s.id} className={`hover:bg-slate-50 ${isLicencia ? 'bg-blue-50/40 border-l-4 border-l-blue-300' : ''}`}>
                                        <td className="p-4 font-bold text-slate-700">{formatDate(s.startTime)}</td>
                                        <td className="p-4 capitalize text-slate-500 text-xs">{dayName}</td>
                                        {showEmpCol && <td className="p-4 text-xs font-bold text-indigo-700">{s._empName}</td>}
                                        <td className="p-4 text-center">
                                            <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${codeStyle}`}>{s.code}</span>
                                        </td>
                                        <td className="p-4 text-center font-mono text-xs text-slate-500">{formatTime(s.startTime)} - {formatTime(s.endTime)}</td>
                                        <td className="p-4 text-xs font-bold text-slate-600 truncate max-w-[180px]">{s.objectiveName || objMap[s.objectiveId] || s.objectiveId || '-'}</td>
                                        <td className="p-4 text-center font-bold text-indigo-600">{duration > 0 ? duration.toFixed(1) : '-'}</td>
                                        <td className="p-4 text-center">
                                            {rawCode === 'V'  ? <span className="text-[9px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-bold border border-emerald-200">VACACIONES</span>
                                            : rawCode === 'L'  ? <span className="text-[9px] bg-blue-50 text-blue-700 px-2 py-1 rounded font-bold border border-blue-200">LICENCIA</span>
                                            : rawCode === 'PG' ? <span className="text-[9px] bg-blue-50 text-blue-700 px-2 py-1 rounded font-bold border border-blue-200">PERM. GREMIAL</span>
                                            : rawCode === 'E'  ? <span className="text-[9px] bg-amber-50 text-amber-700 px-2 py-1 rounded font-bold border border-amber-200">ENFERMEDAD</span>
                                            : rawCode === 'A'  ? <span className="text-[9px] bg-amber-50 text-amber-700 px-2 py-1 rounded font-bold border border-amber-200">ART</span>
                                            : rawCode === 'AA' ? <span className="text-[9px] bg-rose-100 text-rose-700 px-2 py-1 rounded font-bold">AUS. INJUST.</span>
                                            : (rawCode === 'F' || rawCode === 'FF' || rawCode === 'FP') ? <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-bold">FRANCO</span>
                                            : (s.status === 'COMPLETED' || s.isCompleted) ? <span className="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-bold">COMPLETADO</span>
                                            : (s.status === 'PRESENT' || s.isPresent) ? <span className="text-[9px] bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold">PRESENTE</span>
                                            : (s.isAbsent || s.status === 'ABSENT') ? <span className="text-[9px] bg-rose-100 text-rose-700 px-2 py-1 rounded font-bold">AUSENTE</span>
                                            : <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-bold">PENDIENTE</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderDetailModal = () => {
        if (!detailItem) return null;

        const NON_WORK_CODES_DETAIL = new Set(['F','FF','V','L','PG','A','E','AA','FP']);

        const LEAVE_DETAIL_CODES = new Set(['V', 'L', 'PG', 'E', 'A', 'AA']);

        // — Opciones para dropdowns —
        const baseShifts = dedupeShiftsByAbsencePriority(detailItem.rawShifts || []);
        const allStatuses = [...new Set(baseShifts.map((s:any) => s.status).filter(Boolean))].sort();
        const allObjectivesDetail = [...new Set(baseShifts.map((s:any) => s.objectiveName || objMap[s.objectiveId] || s.objectiveId).filter(Boolean))].sort();
        const allEmployeesDetail = [...new Set(baseShifts.map((s:any) => s.employeeName).filter(Boolean))].sort();

        // — Aplicar filtros a los turnos crudos —
        const now = new Date();
        const filteredRawShifts = baseShifts.filter((s:any) => {
            const startSec = s.startTime?.seconds ?? s.startTime?._seconds ?? 0;
            const start = new Date(startSec * 1000);

            const code = String(s.code || '').toUpperCase();
            const hasRealStatus = s.isCompleted || s.isPresent
                || s.checkInTime?.seconds || s.realStartTime?.seconds
                || (s.status || '').toUpperCase() === 'COMPLETED'
                || (s.status || '').toUpperCase() === 'PRESENT'
                || LEAVE_DETAIL_CODES.has(code) || s.type === 'NOVEDAD';
            if (start > now && !hasRealStatus) return false;

            const hhmm = `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}`;
            if (detailFilterTimeFrom && hhmm < detailFilterTimeFrom) return false;
            if (detailFilterTimeTo && hhmm > detailFilterTimeTo) return false;
            if (detailFilterStatus && s.status !== detailFilterStatus) return false;
            if (detailFilterObjective) {
                const objName = s.objectiveName || objMap[s.objectiveId] || s.objectiveId || '';
                if (objName !== detailFilterObjective) return false;
            }
            if (detailFilterEmployee && s.employeeName !== detailFilterEmployee) return false;
            return true;
        });

        const rowsWithData = filteredRawShifts
            .sort((a:any,b:any) => (a.startTime?.seconds||0) - (b.startTime?.seconds||0))
            .map((s:any) => {
                const rawCode = (s.code||'').trim().toUpperCase();
                const isNonWork = NON_WORK_CODES_DETAIL.has(rawCode);

                const startSec = s.startTime?.seconds ?? (s.startTime?._seconds);
                const endSec   = s.endTime?.seconds   ?? (s.endTime?._seconds);
                const start = new Date((startSec || 0) * 1000);
                const end   = new Date((endSec   || 0) * 1000);

                const shiftStatus = (s.status || '').toUpperCase();
                const isCompleted = s.isCompleted || shiftStatus === 'COMPLETED';
                const isPresent   = s.isPresent   || shiftStatus === 'PRESENT';
                const isAbsent    = s.isAbsent    || shiftStatus === 'ABSENT';

                const PAID_LEAVE_DETAIL = new Set(['V','L','PG','E','A']);
                const isUnjustAbsentDetail = !PAID_LEAVE_DETAIL.has(rawCode) && isAbsent;
                const objectiveBillable = s._objectiveBillable !== false && shouldBillShiftToObjective(s);
                const duration = objectiveBillable
                    ? resolveShiftDurationHours(s, SHIFT_HOURS_LOOKUP, { unjustifiedAbsent: isUnjustAbsentDetail })
                    : 0;
                const zeroHours = duration === 0;

                const isFT = s.isFrancoTrabajado || rawCode === 'FT';
                const isFF = s.isFrancoCompensatorio || rawCode === 'FF';

                const rStart = s.realStartTime?.seconds ? new Date(s.realStartTime.seconds*1000) : s.checkInTime?.seconds ? new Date(s.checkInTime.seconds*1000) : null;
                const rEnd   = s.realEndTime?.seconds   ? new Date(s.realEndTime.seconds*1000)   : s.checkOutTime?.seconds ? new Date(s.checkOutTime.seconds*1000) : null;
                let rDur: number | null = null;
                if (rStart && rEnd) { const rd = (rEnd.getTime()-rStart.getTime())/3600000; rDur = rd >= 0 && rd <= 36 ? rd : null; }

                // Diurnas/nocturnas calculadas sobre horas REALES cuando existen, 0 si no hay presencia
                const activeStart = rStart ?? start;
                const activeEnd = rEnd ?? end;
                const night = zeroHours || (!rStart && !rEnd) ? 0 : getNightDuration(activeStart, activeEnd);
                const effectiveDur = rDur ?? 0;
                const day = Math.max(0, effectiveDur - night);

                const dateKey = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
                const hFeriado = holidaysData[dateKey] ? (rDur ?? 0) : 0;

                return {
                    id: s.id,
                    date: start,
                    endDate: end,
                    code: rawCode,
                    swapWith: s.swapWith,
                    isOp: !isNonWork,
                    total: duration,
                    day,
                    night,
                    h100: isFT ? (rDur ?? 0) : 0,
                    hFeriado,
                    isFT,
                    isFF,
                    rStart,
                    rEnd,
                    rDur,
                    hasOvertime: rDur != null && rDur > duration + 0.1,
                    isCompleted,
                    isPresent,
                    isAbsent,
                    _absenceStatus: s._absenceStatus,
                    _absenceReason: s._absenceReason,
                    _absenceType: s._absenceType,
                    _coveredBy: s._coveredBy,
                    _coveringFor: s._coveringFor,
                    isLeaveDay: LEAVE_REPORT_CODES.has(rawCode) || rawCode === 'V' || s._objectiveBillable === false,
                    objectiveBillable,
                };
            });

        const totalSum = rowsWithData.reduce((acc:any, curr:any) => ({
            total: acc.total + curr.total,
            horasReales: acc.horasReales + (curr.rDur ?? 0),
            day: acc.day + curr.day,
            night: acc.night + curr.night,
            h100: acc.h100 + curr.h100,
            hFeriado: acc.hFeriado + curr.hFeriado
        }), { total: 0, horasReales: 0, day: 0, night: 0, h100: 0, hFeriado: 0 });

        const horasParaBolsa = totalSum.horasReales - totalSum.h100;
        const excedente = Math.max(0, horasParaBolsa - 200);
        const horasSimples = Math.min(horasParaBolsa, 200);

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm no-print" onClick={() => { setDetailItem(null); setLeavePopoverId(null); }}>
                <div className="bg-white w-full max-w-[95vw] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                    <div className="p-6 bg-slate-50 border-b">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">DETALLE DE HORAS</p>
                                <h2 className="text-2xl font-black text-slate-800 uppercase flex items-center gap-2">
                                    <Users size={24} className="text-indigo-600"/> {detailItem.name}
                                </h2>
                            </div>
                            <button onClick={() => { setDetailItem(null); setLeavePopoverId(null); }} className="p-2 bg-white rounded-full border hover:bg-slate-100"><X size={20}/></button>
                        </div>
                        {/* Filtros */}
                        <div className="flex flex-wrap gap-2 items-center">
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] font-black text-slate-400 uppercase">Hora:</span>
                                <input type="time" value={detailFilterTimeFrom} onChange={e => setDetailFilterTimeFrom(e.target.value)}
                                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
                                <span className="text-slate-400 text-xs">—</span>
                                <input type="time" value={detailFilterTimeTo} onChange={e => setDetailFilterTimeTo(e.target.value)}
                                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
                            </div>
                            {allObjectivesDetail.length > 1 && (
                                <select value={detailFilterObjective} onChange={e => setDetailFilterObjective(e.target.value)}
                                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                                    <option value="">Todos los objetivos</option>
                                    {allObjectivesDetail.map((o:string) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            )}
                            {allEmployeesDetail.length > 1 && (
                                <select value={detailFilterEmployee} onChange={e => setDetailFilterEmployee(e.target.value)}
                                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                                    <option value="">Todos los empleados</option>
                                    {allEmployeesDetail.map((e:string) => <option key={e} value={e}>{e}</option>)}
                                </select>
                            )}
                            <select value={detailFilterStatus} onChange={e => setDetailFilterStatus(e.target.value)}
                                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                                <option value="">Todos los estados</option>
                                {allStatuses.map((st:string) => <option key={st} value={st}>{st}</option>)}
                            </select>
                            {(detailFilterTimeFrom || detailFilterTimeTo || detailFilterObjective || detailFilterEmployee || detailFilterStatus) && (
                                <button onClick={() => { setDetailFilterTimeFrom(''); setDetailFilterTimeTo(''); setDetailFilterObjective(''); setDetailFilterEmployee(''); setDetailFilterStatus(''); }}
                                    className="text-[10px] font-black text-rose-500 hover:text-rose-700 px-2 py-1.5 border border-rose-200 rounded-lg bg-rose-50 hover:bg-rose-100">
                                    Limpiar filtros
                                </button>
                            )}
                            <span className="text-[10px] text-slate-400 ml-auto">{rowsWithData.length} turnos</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto bg-slate-50 p-3">
                        <table className="w-full text-xs text-left border-collapse bg-white shadow-sm rounded-xl overflow-hidden">
                            <thead className="text-[10px] font-black text-slate-500 uppercase border-b border-slate-200 bg-slate-100">
                                <tr>
                                    <th className="py-2 px-3">Fecha</th>
                                    <th className="py-2 px-3">Planificado</th>
                                    <th className="py-2 px-3">Real</th>
                                    <th className="py-2 px-3 text-center">Tipo</th>
                                    <th className="py-2 px-3 text-center border-l border-slate-200 text-slate-400">Hs. Teóricas</th>
                                    <th className="py-2 px-3 text-center text-indigo-600">Hs. Reales</th>
                                    <th className="py-2 px-3 text-center text-amber-500">Diurnas</th>
                                    <th className="py-2 px-3 text-center text-violet-600">Nocturnas</th>
                                    <th className="py-2 px-3 text-center text-orange-500 border-l border-slate-200">Al 50%</th>
                                    <th className="py-2 px-3 text-center text-rose-600">Al 100% (FT)</th>
                                    <th className="py-2 px-3 text-center text-emerald-600">Plus Feriado</th>
                                    <th className="py-2 px-3 text-center">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rowsWithData.map((row:any) => {
                                    const fmt = (d: Date) => d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
                                    const isLicenciaRow = ['L','PG','E','A'].includes(row.code);
                                    const isLeaveClickable = ['E','L','PG','A'].includes(row.code);
                                const detailCodeStyle = row.code === 'PG' ? 'bg-blue-100 text-blue-700 border-blue-300'
                                    : row.code === 'RET' ? 'bg-amber-100 text-amber-800 border-amber-300'
                                    : row.isFT ? 'bg-violet-100 text-violet-700 border-violet-200'
                                    : row.isFF ? 'bg-cyan-100 text-cyan-700 border-cyan-200'
                                    : ['L','V','A','E','AA'].includes(row.code) ? 'bg-rose-50 text-rose-600 border-rose-200'
                                    : 'bg-slate-100 text-slate-600';
                                return (
                                    <tr key={row.id} className={`hover:bg-indigo-50/50 ${isLicenciaRow ? 'bg-blue-50/40 border-l-4 border-l-blue-300' : ''} ${row.hasOvertime ? 'bg-orange-50/30' : ''}`}>
                                        <td className="py-2 px-3 font-bold text-slate-700 whitespace-nowrap">{formatDate({seconds: row.date.getTime()/1000})}</td>
                                        <td className="py-2 px-3 text-slate-500 font-mono whitespace-nowrap">
                                            {row.isLeaveDay ? <span className="text-slate-300">—</span> : `${fmt(row.date)}${row.endDate ? `–${fmt(row.endDate)}` : ''}`}
                                        </td>
                                        <td className="py-2 px-3 font-mono whitespace-nowrap">
                                            {row.rStart && row.rEnd
                                                ? <span className={row.hasOvertime ? 'text-orange-600 font-bold' : 'text-slate-500'}>{fmt(row.rStart)}–{fmt(row.rEnd)}</span>
                                                : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center relative">
                                            {isLeaveClickable ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); setLeavePopoverId(leavePopoverId === row.id ? null : row.id); }}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase border cursor-pointer hover:ring-2 hover:ring-indigo-300 ${detailCodeStyle}`}
                                                    title="Ver detalle de licencia"
                                                >
                                                    {row.code}
                                                </button>
                                            ) : (
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase border ${detailCodeStyle}`}>
                                                    {row.code}
                                                </span>
                                            )}
                                            {leavePopoverId === row.id && (
                                                <div className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-left text-[10px] normal-case font-normal" onClick={e => e.stopPropagation()}>
                                                    <p className="font-black text-slate-700 uppercase text-[9px] mb-2">Novedad RRHH</p>
                                                    <p className="text-slate-600"><span className="font-bold text-slate-500">Tipo:</span> {row._absenceType || (row.code === 'E' ? 'Enfermedad' : row.code === 'L' ? 'Licencia' : row.code === 'PG' ? 'Permiso gremial' : 'Ausencia')}</p>
                                                    {row._absenceReason && <p className="text-slate-600 mt-1"><span className="font-bold text-slate-500">Motivo:</span> {row._absenceReason}</p>}
                                                    <p className="text-slate-600 mt-1"><span className="font-bold text-slate-500">Cubierto por:</span> {row._coveredBy || 'Sin cobertura registrada'}</p>
                                                    {row._coveringFor && (
                                                        <p className="text-slate-600 mt-1"><span className="font-bold text-slate-500">Cubriendo a:</span> {row._coveringFor}</p>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-2 px-3 text-center text-slate-400 border-l border-slate-100">{row.total > 0 ? row.total.toFixed(1) : '-'}</td>
                                        <td className={`py-2 px-3 text-center font-black border-l border-slate-100 ${row.hasOvertime ? 'text-orange-600' : row.rDur != null ? 'text-indigo-600' : 'text-slate-300'}`}>
                                            {row.rDur != null ? row.rDur.toFixed(1) : '—'}
                                            {row.hasOvertime && <span className="text-[9px] ml-1 text-orange-400">+{(row.rDur - row.total).toFixed(1)}</span>}
                                        </td>
                                        <td className="py-2 px-3 text-center font-mono text-amber-600"><div className="flex items-center justify-center gap-1">{row.day > 0 && <Sun size={10}/>} {row.day > 0 ? row.day.toFixed(1) : '-'}</div></td>
                                        <td className="py-2 px-3 text-center font-mono text-violet-600"><div className="flex items-center justify-center gap-1">{row.night > 0 && <Moon size={10}/>} {row.night > 0 ? row.night.toFixed(1) : '-'}</div></td>
                                        <td className="py-2 px-3 text-center text-slate-300 border-l border-slate-100">—</td>
                                        <td className="py-2 px-3 text-center font-black text-rose-600 bg-rose-50/20">{row.h100 > 0 ? row.h100.toFixed(1) : <span className="text-slate-300">—</span>}</td>
                                        <td className="py-2 px-3 text-center font-bold text-emerald-600">{row.hFeriado > 0 ? <span className="bg-emerald-50 px-1.5 py-0.5 rounded">{row.hFeriado.toFixed(1)}</span> : <span className="text-slate-300">—</span>}</td>
                                        <td className="py-2 px-3 text-center whitespace-nowrap">
                                            {row.swapWith && <span className="text-[9px] bg-amber-50 text-amber-600 px-1 rounded border border-amber-100 mr-1">🔁 {row.swapWith}</span>}
                                            {(() => {
                                                if (row.code === 'V') return <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold border border-emerald-200">Vacaciones</span>;
                                                if (['E','L','PG','A','AA'].includes(row.code)) {
                                                    const label = row.code === 'AA' ? 'Injustificada' : mapAbsenceStatusLabel(row._absenceStatus);
                                                    const cls = label === 'Justificada' ? 'bg-emerald-100 text-emerald-700'
                                                        : label === 'Injustificada' ? 'bg-rose-100 text-rose-700'
                                                        : 'bg-violet-100 text-violet-700';
                                                    return <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${cls}`}>{label}</span>;
                                                }
                                                const NON_WORK_LABELS: Record<string,string> = { F:'Franco', FF:'Franco Comp.', FP:'Franco Esp.', RET:'Retén' };
                                                const labelStyle = row.code === 'RET' ? 'text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-black border border-amber-300' : 'text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold';
                                                if (NON_WORK_LABELS[row.code]) return <span className={labelStyle}>{NON_WORK_LABELS[row.code]}</span>;
                                                if (row.hasOvertime) return <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">Extendido +{(row.rDur - row.total).toFixed(1)}h</span>;
                                                if (row.isCompleted) return <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Completado</span>;
                                                if (row.isPresent) return <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold animate-pulse">En servicio</span>;
                                                if (row.rDur != null) return <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">Completado</span>;
                                                if (row.isAbsent) return <span className="text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold">Ausente</span>;
                                                return <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">Pendiente</span>;
                                            })()}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-slate-900 text-white font-bold text-xs">
                                <tr>
                                    <td colSpan={4} className="py-3 px-3 text-right uppercase tracking-wider">Acumulado:</td>
                                    <td className="py-3 px-3 text-center text-slate-400 border-l border-slate-700">{totalSum.total.toFixed(1)}</td>
                                    <td className="py-3 px-3 text-center font-black text-emerald-400">{totalSum.horasReales.toFixed(1)}</td>
                                    <td className="py-3 px-3 text-center text-amber-400">{totalSum.day.toFixed(1)}</td>
                                    <td className="py-3 px-3 text-center text-violet-300">{totalSum.night.toFixed(1)}</td>
                                    <td className="py-3 px-3 text-center text-orange-400 font-black border-l border-slate-700">{excedente > 0 ? excedente.toFixed(1) : '—'}</td>
                                    <td className="py-3 px-3 text-center text-rose-400 font-black">{totalSum.h100.toFixed(1)}</td>
                                    <td className="py-3 px-3 text-center text-emerald-400 font-black">{totalSum.hFeriado > 0 ? totalSum.hFeriado.toFixed(1) : '—'}</td>
                                    <td></td>
                                </tr>
                                <tr className="bg-slate-800 border-t border-slate-700">
                                    <td colSpan={4} className="py-3 px-3 text-right uppercase text-amber-400">Liquidación (200hs):</td>
                                    <td colSpan={4} className="py-3 px-3">
                                        <div className="flex justify-around items-center">
                                            <div className="flex flex-col items-center"><span className="text-[9px] text-slate-400 uppercase">Hs Simples</span><span className="text-white font-mono text-lg">{horasSimples.toFixed(1)}</span></div>
                                            <div className="h-8 w-px bg-slate-600"></div>
                                            <div className="flex flex-col items-center"><span className="text-[9px] text-amber-400 uppercase">Al 50%</span><span className="text-amber-400 font-mono text-lg font-black">{excedente.toFixed(1)}</span></div>
                                        </div>
                                    </td>
                                    <td colSpan={4} className="py-3 px-3 text-center text-xs text-slate-500 italic border-l border-slate-700">* FT y Feriados se pagan aparte.</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    const renderPlanificadoTable = () => {
        if (!objectiveReport.length && !employeeReport.length) {
            return (
                <div className="p-10 text-center bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 animate-in fade-in">
                    <CalendarDays size={48} className="mx-auto mb-2 opacity-20"/>
                    <p className="font-bold uppercase text-sm">Generá el reporte para ver la planificación</p>
                </div>
            );
        }

        // Solo turnos de origen planificado (excluir retenes y cobertura operativa)
        const isPlannedShift = (s: any) => {
            const origin = (s.origin || '').toUpperCase();
            return origin !== 'RETEN'
                && origin !== 'OPERATIONS_COVERAGE'
                && origin !== 'SLA_VIRTUAL'
                && !s.isReten
                && s.resolvedBy !== 'OPERACIONES';
        };

        const allPlannedShifts: any[] = objectiveReport.flatMap(row =>
            (row.rawShifts || [])
                .filter(isPlannedShift)
                .map((s: any) => ({
                    ...s,
                    _objName: row.name,
                    _clientName: row.client,
                }))
        );

        // Deduplicar por id
        const seen = new Set<string>();
        const uniqueShifts = allPlannedShifts.filter(s => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
        });

        // Excluir vacantes — el reporte planificado solo muestra turnos asignados
        const assignedShifts = uniqueShifts.filter(s => !!s.employeeName);

        // Opciones para filtros
        const planObjectiveOptions = [...new Set(assignedShifts.map(s => s._objName).filter(Boolean))].sort();
        const shiftsForEmployeeFilter = planFilterObjective
            ? assignedShifts.filter(s => s._objName === planFilterObjective)
            : assignedShifts;
        const planEmployeeOptions = [...new Set(shiftsForEmployeeFilter.map(s => s.employeeName).filter(Boolean))].sort();

        const filtered = assignedShifts
            .sort((a, b) => (a.startTime?.seconds || 0) - (b.startTime?.seconds || 0))
            .filter(s => {
                if (planFilterObjective && s._objName !== planFilterObjective) return false;
                if (planFilterEmployee) {
                    if (planFilterEmployee === '__VACANTE__') {
                        if (s.employeeName) return false;
                    } else {
                        if (s.employeeName !== planFilterEmployee) return false;
                    }
                }
                if (planFilterDate) {
                    const d = new Date((s.startTime?.seconds || 0) * 1000);
                    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                    if (dateStr !== planFilterDate) return false;
                }
                return true;
            });

        const totalTeorico = filtered.reduce((acc, s) => {
            return acc + resolveShiftDurationHours(s, SHIFT_HOURS_LOOKUP, { forObjectiveBilling: true });
        }, 0);
        const vacantCount = 0;
        const staffedCount = filtered.length;

        return (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 flex flex-wrap gap-3 items-center no-print">
                    <h3 className="font-black text-sm uppercase flex gap-2 items-center text-slate-800 dark:text-white flex-1 min-w-[150px]">
                        <CalendarDays size={16} className="text-indigo-600"/> Horas Planificadas
                        <span className="text-[10px] font-normal text-slate-400 normal-case">({filtered.length} turnos · {totalTeorico.toFixed(1)} hs)</span>
                    </h3>
                    <select value={planFilterObjective} onChange={e => { setPlanFilterObjective(e.target.value); setPlanFilterEmployee(''); }}
                        className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 bg-white min-w-[180px]">
                        <option value="">Todos los objetivos</option>
                        {planObjectiveOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <select value={planFilterEmployee} onChange={e => setPlanFilterEmployee(e.target.value)}
                        className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 bg-white min-w-[180px]">
                        <option value="">Todos los empleados</option>
                        {planEmployeeOptions.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <div>
                        <input type="date" value={planFilterDate} onChange={e => setPlanFilterDate(e.target.value)}
                            className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-600 bg-white"/>
                    </div>
                    {(planFilterObjective || planFilterEmployee || planFilterDate) && (
                        <button onClick={() => { setPlanFilterObjective(''); setPlanFilterEmployee(''); setPlanFilterDate(''); }}
                            className="text-[10px] font-black text-rose-500 hover:text-rose-700 px-2 py-1.5 border border-rose-200 rounded-lg bg-rose-50">
                            Limpiar
                        </button>
                    )}
                    <button onClick={() => downloadCSV(filtered.map(s => ({
                        fecha: formatDate(s.startTime),
                        empleado: s.employeeName || 'VACANTE',
                        objetivo: s._objName || '-',
                        cliente: s._clientName || '-',
                        codigo: s.code || '-',
                        inicio: formatTime(s.startTime),
                        fin: formatTime(s.endTime),
                    })), 'planificado')} aria-label="Descargar CSV de planificación" className="p-2 bg-white border rounded hover:bg-slate-100 text-slate-500">
                        <Download size={16} aria-hidden="true"/>
                    </button>
                </div>

                {/* KPIs rápidos */}
                <div className="grid grid-cols-3 divide-x border-b border-slate-200 bg-white no-print">
                    <div className="p-4 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Turnos cubiertos</p>
                        <p className="text-2xl font-black text-emerald-600">{staffedCount}</p>
                    </div>
                    <div className="p-4 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Hs. Teóricas</p>
                        <p className="text-2xl font-black text-indigo-600">{totalTeorico.toFixed(1)}</p>
                    </div>
                    <div className="p-4 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Total turnos</p>
                        <p className="text-2xl font-black text-slate-700">{filtered.length}</p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-200">
                            <tr>
                                <th className="p-4">Fecha</th>
                                <th className="p-4">Día</th>
                                <th className="p-4">Empleado</th>
                                <th className="p-4">Objetivo</th>
                                <th className="p-4">Cliente</th>
                                <th className="p-4 text-center">Código</th>
                                <th className="p-4 text-center">Horario</th>
                                <th className="p-4 text-center text-indigo-600">Hs. Teóricas</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map((s: any) => {
                                const startD = s.startTime?.seconds ? new Date(s.startTime.seconds * 1000) : null;
                                const endD = s.endTime?.seconds ? new Date(s.endTime.seconds * 1000) : null;
                                const code = (s.code || '').trim().toUpperCase();
                                const dur = resolveShiftDurationHours(s, SHIFT_HOURS_LOOKUP, { forObjectiveBilling: true });
                                const isZero = dur === 0;
                                const fmt = (d: Date) => d.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
                                const dayName = startD ? startD.toLocaleDateString('es-AR', {weekday:'short'}) : '-';
                                const isVacant = !s.employeeName;
                                return (
                                    <tr key={s.id} className={`hover:bg-indigo-50/30 ${isVacant ? 'bg-amber-50/30' : ''}`}>
                                        <td className="p-4 font-bold text-slate-700 whitespace-nowrap">{startD ? formatDate(s.startTime) : '-'}</td>
                                        <td className="p-4 text-xs text-slate-500 capitalize">{dayName}</td>
                                        <td className={`p-4 font-bold text-sm ${isVacant ? 'text-amber-600 italic' : 'text-slate-700'}`}>
                                            {s.employeeName || 'VACANTE'}
                                        </td>
                                        <td className="p-4 text-xs text-slate-600 font-bold truncate max-w-[160px]">{s._objName || '-'}</td>
                                        <td className="p-4 text-xs text-slate-400 truncate max-w-[120px]">{s._clientName || '-'}</td>
                                        <td className="p-4 text-center">
                                            <span className={`px-2 py-1 rounded text-[10px] font-black uppercase border ${isZero ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>{code || '-'}</span>
                                        </td>
                                        <td className="p-4 text-center font-mono text-xs text-slate-500">
                                            {startD && endD ? `${fmt(startD)} – ${fmt(endD)}` : '-'}
                                        </td>
                                        <td className={`p-4 text-center font-black ${isZero ? 'text-slate-300' : 'text-indigo-600'}`}>
                                            {isZero ? '—' : dur > 0 ? dur.toFixed(1) : '-'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-slate-900 text-white font-black text-xs uppercase">
                            <tr>
                                <td colSpan={5} className="p-4 text-right">TOTAL</td>
                                <td className="p-4 text-center">{filtered.length} turnos</td>
                                <td className="p-4 text-center">{filtered.length} turnos planificados</td>
                                <td className="p-4 text-center text-emerald-400">{totalTeorico.toFixed(1)} hs</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <DashboardLayout>
            <Head><title>Reportes | COSP V1.0</title></Head>
            <PrintStyles />
            <PageShell>
                <div className="max-w-7xl mx-auto space-y-6">
                <div className="no-print">
                    <PageHeader
                        title="Centro de Reportes"
                        subtitle="Liquidación CCT 507/07"
                        icon={BarChart3}
                    />
                    <TabBar
                        tabs={[
                            { id: 'EMPLOYEE',    label: 'Liquidación', icon: Users },
                            { id: 'SHIFTS',      label: 'Detalle Turnos', icon: Calendar },
                            { id: 'OBJECTIVE',   label: 'Por Objetivo', icon: Building },
                            { id: 'PLANIFICADO', label: 'Planificado', icon: CalendarDays },
                            { id: 'AUDIT',       label: 'Auditoría', icon: FileText },
                        ]}
                        active={activeTab}
                        onChange={id => setActiveTab(id as typeof activeTab)}
                    />
                </div>

                <ContentCard padding={false} className="p-4 flex flex-wrap gap-4 items-end no-print">
                    <div className="flex-1 min-w-[150px]">
                        <label htmlFor="rpt-date-desde" className="text-[10px] font-bold text-slate-400 uppercase">Desde</label>
                        <input id="rpt-date-desde" type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="w-full p-2 border rounded-xl font-bold text-sm"/>
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label htmlFor="rpt-date-hasta" className="text-[10px] font-bold text-slate-400 uppercase">Hasta</label>
                        <input id="rpt-date-hasta" type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="w-full p-2 border rounded-xl font-bold text-sm"/>
                    </div>

                    {/* ── Chips de mes rápido ── */}
                    <div className="w-full flex flex-wrap gap-2 items-center border-t border-slate-100 dark:border-slate-700 pt-3 mt-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase shrink-0">Período:</span>
                        {[0, 1, 2, 3].map(offset => {
                            const d = new Date();
                            d.setMonth(d.getMonth() - offset);
                            const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
                            const me = new Date(d.getFullYear(), d.getMonth()+1, 0);
                            const mes = `${me.getFullYear()}-${String(me.getMonth()+1).padStart(2,'0')}-${String(me.getDate()).padStart(2,'0')}`;
                            const lbl = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
                            const isActive = dateRange.start === ms && dateRange.end === mes;
                            return (
                                <button key={offset}
                                    onClick={() => setDateRange({ start: ms, end: mes })}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${isActive ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'}`}>
                                    {lbl}
                                </button>
                            );
                        })}
                        {(['Q1','Q2','Q3','Q4'] as const).map(q => {
                            const year = new Date().getFullYear();
                            const qm: Record<string,[number,number]> = { Q1:[1,3], Q2:[4,6], Q3:[7,9], Q4:[10,12] };
                            const [m1, m2] = qm[q];
                            const qs = `${year}-${String(m1).padStart(2,'0')}-01`;
                            const qe = new Date(year, m2, 0);
                            const qes = `${year}-${String(m2).padStart(2,'0')}-${String(qe.getDate()).padStart(2,'0')}`;
                            const isActive = dateRange.start === qs && dateRange.end === qes;
                            return (
                                <button key={q}
                                    onClick={() => setDateRange({ start: qs, end: qes })}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-500 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40'}`}>
                                    {q} {year}
                                </button>
                            );
                        })}
                    </div>

                    {activeTab === 'SHIFTS' && (<>
                        <div className="min-w-[180px]">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Empleado</label>
                            <select value={selectedDetailEmployee} onChange={e => setSelectedDetailEmployee(e.target.value)}
                                className="w-full p-2.5 border-2 border-indigo-100 bg-indigo-50/30 rounded-xl font-bold text-sm text-slate-700 outline-none focus:border-indigo-500">
                                <option value="">Todos los empleados</option>
                                {sortedEmployeeReport.map(emp => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.legajo ? `[${emp.legajo}] ` : ''}{emp.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="min-w-[160px]">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Objetivo</label>
                            <select value={shiftsFilterObjective} onChange={e => setShiftsFilterObjective(e.target.value)}
                                className="w-full p-2.5 border-2 border-slate-100 rounded-xl font-bold text-sm text-slate-700 outline-none focus:border-indigo-500">
                                <option value="">Todos los objetivos</option>
                                {[...new Set(employeeReport.flatMap(e => (e.rawShifts||[]).map((s: any) => s.objectiveName || objMap[s.objectiveId] || s.objectiveId).filter(Boolean)))].sort().map((o: any) => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </div>
                        <div className="min-w-[200px]">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Hora inicio</label>
                            <div className="flex items-center gap-1">
                                <input type="time" value={shiftsFilterTimeFrom} onChange={e => setShiftsFilterTimeFrom(e.target.value)}
                                    className="flex-1 p-2.5 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-500"/>
                                <span className="text-slate-400 text-xs font-bold">—</span>
                                <input type="time" value={shiftsFilterTimeTo} onChange={e => setShiftsFilterTimeTo(e.target.value)}
                                    className="flex-1 p-2.5 border-2 border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-500"/>
                            </div>
                        </div>
                        <div className="min-w-[140px]">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Estado</label>
                            <select value={shiftsFilterStatus} onChange={e => setShiftsFilterStatus(e.target.value)}
                                className="w-full p-2.5 border-2 border-slate-100 rounded-xl font-bold text-sm text-slate-700 outline-none focus:border-indigo-500">
                                <option value="">Todos los estados</option>
                                <option value="COMPLETADO">Completado</option>
                                <option value="PRESENTE">Presente</option>
                                <option value="AUSENTE">Ausente injustificada</option>
                                <option value="AUS. INJUST.">Aus. injustificada (AA)</option>
                                <option value="VACACIONES">Vacaciones</option>
                                <option value="LICENCIA">Licencia</option>
                                <option value="ENFERMEDAD">Enfermedad</option>
                                <option value="ART">ART</option>
                                <option value="PERM. GREMIAL">Perm. Gremial</option>
                                <option value="FRANCO">Franco</option>
                                <option value="PENDIENTE">Pendiente</option>
                            </select>
                        </div>
                    </>)}

                    {activeTab === 'AUDIT' && auditLogs.length > 0 && (
                        <div className="min-w-[180px]">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Actor</label>
                            <select value={auditFilterActor} onChange={e => setAuditFilterActor(e.target.value)}
                                className="w-full p-2.5 border-2 border-slate-100 rounded-xl font-bold text-sm text-slate-700 outline-none focus:border-indigo-500">
                                <option value="">Todos los actores</option>
                                {[...new Set(auditLogs.map((l: any) => l.actorName || 'Sistema').filter(Boolean))].sort().map(a => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex-1 min-w-[200px]">
                        <label htmlFor="rpt-publish-filter" className="text-[10px] font-bold text-slate-400 uppercase">Cronograma</label>
                        <select
                            id="rpt-publish-filter"
                            value={publishFilter}
                            onChange={e => setPublishFilter(e.target.value as ReportPublishFilter)}
                            className="w-full p-2 border rounded-xl font-bold text-sm text-slate-700 bg-white"
                        >
                            <option value="all">Todos (publicados + borrador draft)</option>
                            <option value="published">Solo publicados (liquidación oficial)</option>
                            <option value="unpublished">Solo borrador / no publicados</option>
                        </select>
                    </div>

                    <button onClick={() => activeTab === 'AUDIT' ? loadAudit() : generateReports()} className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase hover:bg-slate-800 transition-colors">
                        {loading ? 'Procesando...' : 'Generar Reporte'}
                    </button>
                </ContentCard>

                {/* ── KPI Resumen Ejecutivo ── */}
                {(employeeReport.length > 0 || objectiveReport.length > 0) && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                        {[
                            {
                                label: 'Empleados',
                                value: employeeReport.length,
                                sub: `${employeeReport.reduce((a,c)=>a+(c.shiftsTotal ?? c.shifts ?? 0),0)} turnos`,
                                icon: '👤',
                                color: 'from-indigo-500 to-indigo-600',
                            },
                            {
                                label: 'Hs. Teóricas',
                                value: employeeReport.reduce((a,c)=>a+(c.total||0),0).toFixed(1),
                                sub: 'horas planificadas',
                                icon: '🕐',
                                color: 'from-sky-500 to-sky-600',
                            },
                            {
                                label: 'Hs. Reales',
                                value: employeeReport.reduce((a,c)=>a+(c.horasReales||c.total||0),0).toFixed(1),
                                sub: 'horas trabajadas',
                                icon: '✅',
                                color: 'from-emerald-500 to-emerald-600',
                            },
                            {
                                label: 'Objetivos',
                                value: objectiveReport.length,
                                sub: 'en el período',
                                icon: '🏢',
                                color: 'from-violet-500 to-violet-600',
                            },
                        ].map(kpi => (
                            <div key={kpi.label} className="relative overflow-hidden bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 shadow-sm">
                                <div className={`absolute inset-0 bg-gradient-to-br ${kpi.color} opacity-5 dark:opacity-10`}/>
                                <div className="relative flex items-start gap-3">
                                    <div className="text-2xl leading-none mt-0.5">{kpi.icon}</div>
                                    <div>
                                        <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">{kpi.label}</p>
                                        <p className="text-2xl font-black text-slate-800 dark:text-white leading-tight">{kpi.value}</p>
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{kpi.sub}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'EMPLOYEE' && renderEmployeeTable()}
                {activeTab === 'SHIFTS' && renderShiftsDetailTable()}
                {activeTab === 'OBJECTIVE' && renderObjectiveTable()}
                {activeTab === 'PLANIFICADO' && renderPlanificadoTable()}

                {activeTab === 'AUDIT' && (
                    <ContentCard padding={false} className="overflow-hidden">
                        {auditLogs.length > 0 && auditFilterActor && (
                            <div className="px-4 py-2 border-b bg-indigo-50 flex items-center gap-2 text-xs">
                                <span className="font-black text-slate-500 uppercase">Filtrando por:</span>
                                <span className="font-bold text-indigo-700 bg-white border border-indigo-200 px-2 py-0.5 rounded">{auditFilterActor}</span>
                                <button onClick={() => setAuditFilterActor('')} className="ml-auto text-rose-500 hover:text-rose-700 font-black">✕ Limpiar</button>
                            </div>
                        )}
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 font-bold uppercase text-[10px]">
                                <tr><th className="p-4">Fecha</th><th className="p-4">Actor</th><th className="p-4">Acción</th><th className="p-4">Detalle</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {auditLogs
                                    .filter((log: any) => !auditFilterActor || (log.actorName || 'Sistema') === auditFilterActor)
                                    .map((log: any) => (
                                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="p-4"><p className="font-bold">{formatDate(log.timestamp)}</p><p className="text-xs text-slate-400">{formatTime(log.timestamp)}</p></td>
                                        <td className="p-4 font-bold text-indigo-600">{log.actorName || 'Sistema'}</td>
                                        <td className="p-4"><span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">{DICTIONARY[log.action] || log.action}</span></td>
                                        <td className="p-4 text-xs text-slate-500 truncate max-w-xs">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </ContentCard>
                )}

                {renderDetailModal()}
                </div>
            </PageShell>
        </DashboardLayout>
    );
}