import { toast } from 'sonner';
import { getDateKey, isDateLocked } from '@/lib/planificacion/utils';

export type ApplyPlanificacionColumnCopyParams = {
    columnSelectSource: number | null;
    selection: { start: { c: number } | null; end: { c: number } | null };
    daysInMonth: Date[];
    pendingChanges: Record<string, any>;
    displayedEmployees: any[];
    shiftsMap: Record<string, any>;
    selectedObjective: string;
    setPendingChanges: (value: Record<string, any>) => void;
    setSelection: (value: { start: null; end: null }) => void;
    setColumnSelectMode: (value: boolean) => void;
    setColumnSelectSource: (value: null) => void;
    setIsDragging: (value: boolean) => void;
};

export function applyPlanificacionColumnCopy({
    columnSelectSource,
    selection,
    daysInMonth,
    pendingChanges,
    displayedEmployees,
    shiftsMap,
    selectedObjective,
    setPendingChanges,
    setSelection,
    setColumnSelectMode,
    setColumnSelectSource,
    setIsDragging,
}: ApplyPlanificacionColumnCopyParams): void {
    if (columnSelectSource === null || !selection.start || !selection.end) return;
    const startCol = Math.min(selection.start.c, selection.end.c);
    const endCol = Math.max(selection.start.c, selection.end.c);
    const srcDate = getDateKey(daysInMonth[columnSelectSource]);
    const newChanges = { ...pendingChanges };
    let copied = 0;
    displayedEmployees.forEach((emp: any) => {
        const srcKey = `${emp.id}_${srcDate}`;
        const srcShift = pendingChanges[srcKey]
            ? (pendingChanges[srcKey].isDeleted ? null : pendingChanges[srcKey])
            : shiftsMap[srcKey];
        for (let c = startCol; c <= endCol; c++) {
            if (c === columnSelectSource) continue;
            const tgtDate = getDateKey(daysInMonth[c]);
            if (isDateLocked(tgtDate)) continue;
            const tgtKey = `${emp.id}_${tgtDate}`;
            if (!srcShift) {
                if (pendingChanges[tgtKey] || shiftsMap[tgtKey]) newChanges[tgtKey] = { isDeleted: true };
            } else {
                newChanges[tgtKey] = { ...srcShift, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective };
                copied++;
            }
        }
    });
    setPendingChanges(newChanges);
    setSelection({ start: null, end: null });
    setColumnSelectMode(false);
    setColumnSelectSource(null);
    setIsDragging(false);
    toast.success(`Día copiado a ${endCol - startCol} día(s) — ${copied} turnos`);
}
