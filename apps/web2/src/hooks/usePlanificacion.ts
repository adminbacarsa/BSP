import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { 
    collection, query, where, getDocs, onSnapshot, 
    addDoc, deleteDoc, doc, Timestamp, updateDoc 
} from 'firebase/firestore';
import { IPlannerEmployee, IPlannerShift, SHIFT_CODES } from '@/types/planificacion.types';
import { toast } from 'sonner';

export const usePlanificacion = () => {
    // --- ESTADOS ---
    const [currentDate, setCurrentDate] = useState(new Date());
    const [employees, setEmployees] = useState<IPlannerEmployee[]>([]);
    const [shifts, setShifts] = useState<IPlannerShift[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Modal de Asignación
    const [selectedCell, setSelectedCell] = useState<{ empId: string, date: Date, currentShift?: IPlannerShift } | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // --- UTILS DE FECHAS ---
    const getMonthData = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysArray = Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(year, month, i + 1);
            return {
                day: i + 1,
                date: d,
                isToday: d.toDateString() === new Date().toDateString(),
                isWeekend: d.getDay() === 0 || d.getDay() === 6
            };
        });
        return { year, month, daysInMonth, daysArray };
    };

    const { daysArray, year, month } = getMonthData();

    // --- CARGA DE DATOS ---
    useEffect(() => {
        // 1. Cargar Empleados (Solo una vez)
        const loadEmployees = async () => {
            const q = query(collection(db, 'empleados'));
            const snap = await getDocs(q);
            const emps = snap.docs.map(d => ({ 
                id: d.id, 
                fullName: d.data().name || `${d.data().lastName} ${d.data().firstName}` 
            }));
            setEmployees(emps);
        };
        loadEmployees();
    }, []);

    useEffect(() => {
        // 2. Cargar Turnos del Mes Actual (Escucha en tiempo real)
        setLoading(true);
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

        const q = query(
            collection(db, 'turnos'),
            where('startTime', '>=', Timestamp.fromDate(startOfMonth)),
            where('startTime', '<=', Timestamp.fromDate(endOfMonth))
        );

        const unsubscribe = onSnapshot(q, (snap) => {
            const loadedShifts = snap.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as IPlannerShift[];
            setShifts(loadedShifts);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentDate]);

    // --- ACCIONES ---
    const navigateMonth = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1));
        setCurrentDate(newDate);
    };

    const handleCellClick = (empId: string, date: Date) => {
        // Buscar si ya existe turno
        const existing = shifts.find(s => 
            s.employeeId === empId && 
            s.startTime.toDate().toDateString() === date.toDateString()
        );
        setSelectedCell({ empId, date, currentShift: existing });
        setIsModalOpen(true);
    };

    const assignShift = async (code: string) => {
        if (!selectedCell) return;
        
        try {
            const emp = employees.find(e => e.id === selectedCell.empId);
            if (!emp) return;

            // Configurar horas base según código
            const start = new Date(selectedCell.date);
            const end = new Date(selectedCell.date);
            
            if (code === 'M') { start.setHours(6,0,0); end.setHours(14,0,0); }
            else if (code === 'T') { start.setHours(14,0,0); end.setHours(22,0,0); }
            else if (code === 'N') { start.setHours(22,0,0); end.setHours(6,0,0); end.setDate(end.getDate() + 1); }
            else { start.setHours(9,0,0); end.setHours(18,0,0); } // Franco/Default

            const payload = {
                employeeId: emp.id,
                employeeName: emp.fullName,
                startTime: Timestamp.fromDate(start),
                endTime: Timestamp.fromDate(end),
                code: code,
                status: code === 'F' ? 'COMPLETED' : 'PENDING',
                isFranco: code === 'F',
                // Campos dummy requeridos por reglas de seguridad
                clientId: 'MANUAL', clientName: 'Planificación Manual',
                objectiveId: 'MANUAL', objectiveName: 'General'
            };

            if (selectedCell.currentShift) {
                await updateDoc(doc(db, 'turnos', selectedCell.currentShift.id), payload);
                toast.success("Turno actualizado");
            } else {
                await addDoc(collection(db, 'turnos'), payload);
                toast.success("Turno asignado");
            }
            setIsModalOpen(false);
        } catch (e) {
            console.error(e);
            toast.error("Error asignando turno");
        }
    };

    const deleteShift = async () => {
        if (!selectedCell?.currentShift) return;
        try {
            await deleteDoc(doc(db, 'turnos', selectedCell.currentShift.id));
            toast.success("Turno eliminado");
            setIsModalOpen(false);
        } catch (e) { toast.error("Error al eliminar"); }
    };

    // Helper para renderizar
    const getShiftForCell = (empId: string, date: Date) => {
        return shifts.find(s => 
            s.employeeId === empId && 
            s.startTime.toDate().toDateString() === date.toDateString()
        );
    };

    return {
        currentDate, daysArray, employees, loading,
        isModalOpen, setIsModalOpen, selectedCell, SHIFT_CODES,
        navigateMonth, handleCellClick, assignShift, deleteShift, getShiftForCell
    };
};