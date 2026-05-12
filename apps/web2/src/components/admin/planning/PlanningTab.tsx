
import React, { useState, useEffect, useMemo } from 'react';
import { db, functions } from '@/lib/firebase';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { 
    Calendar as CalendarIcon, ShieldAlert, Lock, Trash2, User, 
    ChevronLeft, ChevronRight, Filter, Download
} from 'lucide-react';
import { toast } from 'sonner';
import { startOfWeek, addDays, format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';

export default function PlanningTab() {
    const [shifts, setShifts] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'WEEK' | 'MONTH'>('WEEK');

    // 1. CARGA EN TIEMPO REAL (CRÍTICO PARA VER EL VERDE AL INSTANTE)
    useEffect(() => {
        // Escuchamos empleados
        const unsubEmp = onSnapshot(collection(db, 'employees'), (snap) => {
            setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        // Escuchamos turnos
        const q = query(collection(db, 'turnos'));
        const unsubShifts = onSnapshot(q, (snap) => {
            const data = snap.docs.map(d => {
                const s = d.data();
                return {
                    id: d.id,
                    ...s,
                    start: s.startTime?.toDate(),
                    end: s.endTime?.toDate()
                };
            });
            setShifts(data);
        });

        return () => { unsubEmp(); unsubShifts(); };
    }, []);

    // 2. GENERAR DÍAS DE LA GRILLA
    const days = useMemo(() => {
        const start = viewMode === 'WEEK' ? startOfWeek(currentDate, { weekStartsOn: 1 }) : startOfMonth(currentDate);
        const end = viewMode === 'WEEK' ? addDays(start, 6) : endOfMonth(currentDate);
        return eachDayOfInterval({ start, end });
    }, [currentDate, viewMode]);

    // 3. LÓGICA DE COLOR (AQUÍ ESTÁ LA MAGIA)
    const getShiftStyle = (shift: any) => {
        // PRIORIDAD 1: ESTADO (Si ya fichó, VERDE)
        if (shift.status === 'PRESENT') {
            return 'bg-emerald-100 text-emerald-700 border-emerald-300 font-black'; // VERDE = PRESENTE
        }
        if (shift.status === 'ABSENT') {
            return 'bg-rose-100 text-rose-700 border-rose-300 font-black'; // ROJO = AUSENTE
        }
        if (shift.status === 'COMPLETED') {
            return 'bg-blue-100 text-blue-700 border-blue-300 font-bold'; // AZUL = FINALIZADO
        }

        // PRIORIDAD 2: TIPO DE TURNO (Si es pendiente)
        // Detectamos tipo por hora (simple) o por campo 'type'
        const hour = shift.start?.getHours() || 0;
        if (hour >= 21 || hour <= 5) return 'bg-indigo-50 text-indigo-600 border-indigo-100'; // NOCHE
        if (hour >= 13) return 'bg-sky-50 text-sky-600 border-sky-100'; // TARDE
        
        return 'bg-amber-50 text-amber-600 border-amber-100'; // MAÑANA
    };

    const getShiftLabel = (shift: any) => {
        if (shift.status === 'ABSENT') return 'AUS';
        // Letra según hora
        const hour = shift.start?.getHours() || 0;
        if (hour >= 21 || hour <= 5) return 'N'; // Noche
        if (hour >= 13) return 'T'; // Tarde
        return 'M'; // Mañana
    };

    // --- MANEJO DE CLIC EN CELDA (SEGURIDAD) ---
    const handleShiftClick = (shift: any) => {
        if (shift.status === 'PRESENT' || shift.status === 'COMPLETED') {
            alert(`🔒 TURNO BLINDADO\n\nEstado: ${shift.status}\nEmpleado: ${shift.employeeName}\n\nEste turno ya inició o finalizó. No se puede modificar desde la grilla rápida.`);
            return;
        }
        
        if (confirm(`¿Borrar turno pendiente de ${shift.employeeName}?`)) {
            deleteDoc(doc(db, 'turnos', shift.id));
            toast.success("Turno eliminado");
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 animate-in fade-in flex flex-col h-[calc(100vh-120px)]">
            
            {/* HEADER */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-xl font-black uppercase dark:text-white flex items-center gap-2">
                        <CalendarIcon size={24} className="text-indigo-600"/> Dotación y Turnos
                    </h2>
                    <p className="text-xs text-slate-500">Vista matricial de asignaciones.</p>
                </div>
                
                <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900 p-2 rounded-xl">
                    <div className="flex items-center gap-2">
                        <button onClick={() => setViewMode('WEEK')} className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${viewMode === 'WEEK' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}>SEMANA</button>
                        <button onClick={() => setViewMode('MONTH')} className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${viewMode === 'MONTH' ? 'bg-white shadow text-indigo-600' : 'text-slate-400'}`}>MES</button>
                    </div>
                    <div className="h-4 w-px bg-slate-300 mx-2"></div>
                    <div className="flex gap-1">
                        <button onClick={() => setCurrentDate(d => addDays(d, viewMode === 'WEEK' ? -7 : -30))} className="p-1 hover:bg-slate-200 rounded"><ChevronLeft size={16}/></button>
                        <span className="text-sm font-black uppercase w-32 text-center">
                            {format(currentDate, viewMode === 'WEEK' ? "'Semana' w" : 'MMMM yyyy', { locale: es })}
                        </span>
                        <button onClick={() => setCurrentDate(d => addDays(d, viewMode === 'WEEK' ? 7 : 30))} className="p-1 hover:bg-slate-200 rounded"><ChevronRight size={16}/></button>
                    </div>
                </div>
            </div>

            {/* LEYENDA */}
            <div className="flex gap-4 text-[10px] font-bold uppercase mb-4 px-2">
                <div className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-100 border border-emerald-300 rounded block"></span> Presente</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 bg-sky-50 border border-sky-100 rounded block"></span> Tarde (Pend)</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-50 border border-indigo-100 rounded block"></span> Noche (Pend)</div>
                <div className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-100 border border-rose-300 rounded block"></span> Ausente</div>
            </div>

            {/* GRILLA (SCROLLABLE) */}
            <div className="flex-1 overflow-auto border rounded-xl dark:border-slate-700 relative">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900 shadow-sm">
                        <tr>
                            <th className="p-4 min-w-[200px] text-xs font-black text-slate-400 uppercase tracking-wider border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-900 sticky left-0 z-20">Empleado</th>
                            {days.map(day => (
                                <th key={day.toISOString()} className={`p-2 text-center min-w-[50px] border-b border-l dark:border-slate-700 ${isSameDay(day, new Date()) ? 'bg-indigo-50/50 text-indigo-600' : ''}`}>
                                    <div className="text-[10px] font-bold uppercase text-slate-400">{format(day, 'EEE', { locale: es })}</div>
                                    <div className="text-sm font-black text-slate-700 dark:text-slate-300">{format(day, 'd')}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {employees.map(emp => (
                            <tr key={emp.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                                {/* COLUMNA EMPLEADO (FIJA) */}
                                <td className="p-3 sticky left-0 bg-white dark:bg-slate-800 z-10 border-r dark:border-slate-700 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500">
                                            {emp.firstName?.charAt(0)}{emp.lastName?.charAt(0)}
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-slate-700 dark:text-white truncate max-w-[140px]">{emp.firstName} {emp.lastName}</div>
                                            <div className="text-[9px] text-slate-400 uppercase">Guardia</div>
                                        </div>
                                    </div>
                                </td>

                                {/* CELDAS DÍAS */}
                                {days.map(day => {
                                    // Buscar turno para este empleado en este día
                                    const dayShift = shifts.find(s => 
                                        s.employeeId === emp.id && 
                                        isSameDay(s.start, day)
                                    );

                                    return (
                                        <td key={day.toISOString()} className="p-1 border-l dark:border-slate-700 relative h-12">
                                            {dayShift ? (
                                                <button 
                                                    onClick={() => handleShiftClick(dayShift)}
                                                    className={`w-full h-full rounded-lg border text-xs flex items-center justify-center transition-all hover:scale-95 ${getShiftStyle(dayShift)}`}
                                                    title={`${dayShift.clientName} - ${dayShift.status}`}
                                                >
                                                    {getShiftLabel(dayShift)}
                                                </button>
                                            ) : (
                                                <div className="w-full h-full hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg cursor-pointer group flex items-center justify-center">
                                                    <span className="hidden group-hover:block text-slate-300 text-lg">+</span>
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
