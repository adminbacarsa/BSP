import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { getDateKey } from '@/lib/planificacion/utils';

export type ApplyPlanificacionPrevMonthTemplateParams = {
    selectedObjective: string;
    currentDate: Date;
    pendingChanges: Record<string, any>;
    daysInMonth: Date[];
    displayedEmployees: any[];
    shiftsMap: Record<string, any>;
    isPlanningDateLocked: (dateStr: string) => boolean;
    setPendingChanges: (changes: Record<string, any>) => void;
    setPrevMonthLoading: (value: boolean) => void;
};

export async function applyPlanificacionPrevMonthTemplate({
    selectedObjective,
    currentDate,
    pendingChanges,
    daysInMonth,
    displayedEmployees,
    shiftsMap,
    isPlanningDateLocked,
    setPendingChanges,
    setPrevMonthLoading,
}: ApplyPlanificacionPrevMonthTemplateParams): Promise<void> {
    if (!selectedObjective) return;
    setPrevMonthLoading(true);
    try {
        const prevStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        const prevEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
        const snap = await getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', selectedObjective),
            where('startTime', '>=', Timestamp.fromDate(prevStart)),
            where('startTime', '<=', Timestamp.fromDate(prevEnd)),
        ));
        const prevShifts = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
        const newChanges = { ...pendingChanges };
        let applied = 0;
        let skipped = 0;
        prevShifts.forEach((shift: any) => {
            const shiftDate = shift.startTime?.toDate
                ? shift.startTime.toDate()
                : new Date(shift.startTime?.seconds * 1000);
            const dayNum = shiftDate.getDate();
            const targetDay = daysInMonth.find(d => d.getDate() === dayNum);
            if (!targetDay) return;
            const targetDateStr = getDateKey(targetDay);
            if (isPlanningDateLocked(targetDateStr)) return;
            if (!displayedEmployees.find((e: any) => e.id === shift.employeeId)) return;
            const key = `${shift.employeeId}_${targetDateStr}`;
            if (pendingChanges[key] || shiftsMap[key]) {
                skipped++;
                return;
            }
            const { id: _id, ...rest } = shift;
            newChanges[key] = { ...rest, isTemp: true, employeeId: shift.employeeId, objectiveId: selectedObjective };
            applied++;
        });
        setPendingChanges(newChanges);
        toast.success(`Plantilla aplicada: ${applied} turnos importados${skipped > 0 ? `, ${skipped} omitidos (ya tenían turno)` : ''}`);
    } catch {
        toast.error('Error al cargar el mes anterior');
    } finally {
        setPrevMonthLoading(false);
    }
}
