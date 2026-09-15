import { toast } from 'sonner';
import { getDateKey } from '@/lib/planificacion/utils';
import { isShiftConsolidated } from '@/lib/planificacion/planificacionShiftViewUtils';

export type PlanificacionClipboardCell = {
    relRow: number;
    relCol: number;
    shift: any | null;
};

export type PlanificacionClipboardBounds = {
    minR: number;
    maxR: number;
    minC: number;
    maxC: number;
    cells: PlanificacionClipboardCell[];
};

export type CopyPlanificacionSelectionParams = {
    asCut: boolean;
    allowPlanningMultiSelect: boolean;
    selection: { start: { r: number; c: number } | null; end: { r: number; c: number } | null };
    displayedEmployees: any[];
    daysInMonth: Date[];
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    setClipboard: (cells: PlanificacionClipboardCell[]) => void;
    setClipboardDim: (dim: { rows: number; cols: number }) => void;
    setClipboardIsCut: (asCut: boolean) => void;
};

export function copyPlanificacionSelectionToClipboard({
    asCut,
    allowPlanningMultiSelect,
    selection,
    displayedEmployees,
    daysInMonth,
    pendingChanges,
    shiftsMap,
    setClipboard,
    setClipboardDim,
    setClipboardIsCut,
}: CopyPlanificacionSelectionParams): PlanificacionClipboardBounds | null {
    if (!allowPlanningMultiSelect) return null;
    if (!selection.start) return null;
    const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r);
    const maxR = Math.max(selection.start.r, selection.end?.r ?? selection.start.r);
    const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c);
    const maxC = Math.max(selection.start.c, selection.end?.c ?? selection.start.c);
    const cells: PlanificacionClipboardCell[] = [];
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
            const emp = displayedEmployees[r];
            if (!emp || c >= daysInMonth.length) continue;
            const key = `${emp.id}_${getDateKey(daysInMonth[c])}`;
            const shift = pendingChanges[key]
                ? (pendingChanges[key].isDeleted ? null : pendingChanges[key])
                : (shiftsMap[key] || null);
            cells.push({ relRow: r - minR, relCol: c - minC, shift });
        }
    }
    setClipboard(cells);
    setClipboardDim({ rows: maxR - minR + 1, cols: maxC - minC + 1 });
    setClipboardIsCut(asCut);
    return { minR, maxR, minC, maxC, cells };
}

export type PastePlanificacionClipboardParams = {
    targetRow: number;
    targetCol: number;
    allowPlanningMultiSelect: boolean;
    clipboard: PlanificacionClipboardCell[] | null;
    clipboardIsCut: boolean;
    pendingChanges: Record<string, any>;
    displayedEmployees: any[];
    daysInMonth: Date[];
    shiftsMap: Record<string, any>;
    isPlanningDateLocked: (dateStr: string) => boolean;
    selectedGrupo: { objectiveIds: string[] } | null;
    grupoUnifiedMode: boolean;
    selectedObjective: string;
    resolveObjectiveForEmp: (empId: string) => string;
    commitPendingChanges: (changes: Record<string, any>) => void;
    setClipboardIsCut: (value: boolean) => void;
};

export function pastePlanificacionClipboardAt({
    targetRow,
    targetCol,
    allowPlanningMultiSelect,
    clipboard,
    clipboardIsCut,
    pendingChanges,
    displayedEmployees,
    daysInMonth,
    shiftsMap,
    isPlanningDateLocked,
    selectedGrupo,
    grupoUnifiedMode,
    selectedObjective,
    resolveObjectiveForEmp,
    commitPendingChanges,
    setClipboardIsCut,
}: PastePlanificacionClipboardParams): void {
    if (!allowPlanningMultiSelect) {
        toast.message('Cronograma publicado — activá modo Corregir para pegar en masa.');
        return;
    }
    if (!clipboard) return;
    const newChanges = { ...pendingChanges };
    let pasted = 0;
    clipboard.forEach(({ relRow, relCol, shift }) => {
        const r = targetRow + relRow;
        const c = targetCol + relCol;
        if (r < 0 || r >= displayedEmployees.length || c < 0 || c >= daysInMonth.length) return;
        const emp = displayedEmployees[r];
        const dateStr = getDateKey(daysInMonth[c]);
        if (isPlanningDateLocked(dateStr)) return;
        const key = `${emp.id}_${dateStr}`;
        if (!shift) {
            if (newChanges[key] || shiftsMap[key]) newChanges[key] = { isDeleted: true };
        } else {
            newChanges[key] = {
                ...shift,
                isTemp: true,
                employeeId: emp.id,
                objectiveId: (selectedGrupo && grupoUnifiedMode)
                    ? resolveObjectiveForEmp(emp.id)
                    : (shift.objectiveId || selectedObjective),
            };
            pasted++;
        }
    });
    commitPendingChanges(newChanges);
    toast.success(
        clipboardIsCut
            ? `${pasted} turno(s) movido(s)`
            : `${pasted} turno(s) pegado(s) — portapapeles listo para repetir`,
    );
    if (clipboardIsCut) setClipboardIsCut(false);
}

export type CutPlanificacionSelectionParams = {
    allowPlanningMultiSelect: boolean;
    isServiceLocked: boolean;
    activeServiceStatusMsg: string;
    selection: { start: { r: number; c: number } | null; end: { r: number; c: number } | null };
    displayedEmployees: any[];
    daysInMonth: Date[];
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    isPlanningDateLocked: (dateStr: string) => boolean;
    setClipboard: (cells: PlanificacionClipboardCell[]) => void;
    setClipboardDim: (dim: { rows: number; cols: number }) => void;
    setClipboardIsCut: (asCut: boolean) => void;
    commitPendingChanges: (changes: Record<string, any>) => void;
};

export function cutPlanificacionSelection({
    allowPlanningMultiSelect,
    isServiceLocked,
    activeServiceStatusMsg,
    selection,
    displayedEmployees,
    daysInMonth,
    pendingChanges,
    shiftsMap,
    isPlanningDateLocked,
    setClipboard,
    setClipboardDim,
    setClipboardIsCut,
    commitPendingChanges,
}: CutPlanificacionSelectionParams): void {
    if (!allowPlanningMultiSelect) {
        toast.message('Cronograma publicado — activá modo Corregir para edición masiva.');
        return;
    }
    if (isServiceLocked) {
        toast.error(activeServiceStatusMsg || 'Bloqueado');
        return;
    }
    const bounds = copyPlanificacionSelectionToClipboard({
        asCut: true,
        allowPlanningMultiSelect,
        selection,
        displayedEmployees,
        daysInMonth,
        pendingChanges,
        shiftsMap,
        setClipboard,
        setClipboardDim,
        setClipboardIsCut,
    });
    if (!bounds) return;
    const newChanges = { ...pendingChanges };
    let cut = 0;
    for (let r = bounds.minR; r <= bounds.maxR; r++) {
        for (let c = bounds.minC; c <= bounds.maxC; c++) {
            const emp = displayedEmployees[r];
            if (!emp || c >= daysInMonth.length) continue;
            const dateStr = getDateKey(daysInMonth[c]);
            if (isPlanningDateLocked(dateStr)) continue;
            const key = `${emp.id}_${dateStr}`;
            const existing = pendingChanges[key]
                ? (pendingChanges[key].isDeleted ? null : pendingChanges[key])
                : (shiftsMap[key] || null);
            if (isShiftConsolidated(existing)) continue;
            if (existing || pendingChanges[key] || shiftsMap[key]) {
                newChanges[key] = { isDeleted: true };
                cut++;
            }
        }
    }
    commitPendingChanges(newChanges);
    toast.success(`${cut} celda(s) cortada(s) — Ctrl+V para pegar`);
}
