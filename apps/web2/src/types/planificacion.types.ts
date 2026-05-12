import { Timestamp } from 'firebase/firestore';

export interface IPlannerShift {
    id: string;
    employeeId: string;
    employeeName: string;
    startTime: Timestamp;
    endTime: Timestamp;
    code: string; // 'M', 'T', 'N', 'F', etc.
    color?: string; // Para UI
    status: 'PENDING' | 'PRESENT' | 'COMPLETED' | 'ABSENT';
    // Banderas importantes
    isFranco?: boolean;
    isCoverage?: boolean;
    hasNovedad?: boolean;
}

export interface IPlannerEmployee {
    id: string;
    fullName: string;
    // Aquí puedes agregar campos como 'legajo' o 'sector' si los usas para filtrar
}

export interface ICalendarCell {
    day: number;
    date: Date;
    shifts: IPlannerShift[];
    isToday: boolean;
    isWeekend: boolean;
}

export const SHIFT_CODES = {
    'M': { label: 'Mañana', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
    'T': { label: 'Tarde', color: 'bg-orange-100 text-orange-700 border-orange-300' },
    'N': { label: 'Noche', color: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
    'F': { label: 'Franco', color: 'bg-slate-100 text-slate-500 border-slate-300' },
    'X': { label: 'Ausente', color: 'bg-rose-100 text-rose-700 border-rose-300' },
    'C': { label: 'Cubierto', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
};