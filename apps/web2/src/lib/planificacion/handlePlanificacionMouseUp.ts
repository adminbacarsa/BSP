import { toast } from 'sonner';
import { getDateKey } from '@/lib/planificacion/utils';
import { rfzDocToShiftView, isShiftConsolidated } from '@/lib/planificacion/planificacionShiftViewUtils';
import {
    isCrossObjectivePlanningReadOnly,
    isPlanificacionPublished,
    resolveCellShiftDisplay,
} from '@/lib/planificacion/planificacionPlanningShiftRules';
import { planificacionPublishLookupKey } from '@/lib/multiempresa';

export type HandlePlanificacionMouseUpParams = {
    columnSelectMode: boolean;
    isServiceLocked: boolean;
    activeServiceStatusMsg: string;
    selection: {
        start: { r: number; c: number } | null;
        end: { r: number; c: number } | null;
    };
    displayedEmployees: any[];
    daysInMonth: Date[];
    rfzByEmpDate: Record<string, any>;
    selectedObjective: string;
    selectedGrupo: { objectiveIds: string[] } | null;
    grupoUnifiedMode: boolean;
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    cellTurnosMap: Record<string, any[]>;
    absencesMap: Record<string, any>;
    empDefaultPos: Record<string, string>;
    dominantPositionName: string;
    currentDate: Date;
    correctionMode: boolean;
    publishStatusMap: Record<string, unknown>;
    getObjectiveName: (objectiveId: string) => string;
    isPlanningDateLocked: (dateStr: string) => boolean;
    findNeighbors: (problemShift: any, dateStr: string) => void;
    setIsDragging: (value: boolean) => void;
    clearLongPressTimer: () => void;
    setSelection: (value: { start: null; end: null }) => void;
    setActivePosition: (value: string) => void;
    setSelectedCell: (value: {
        empId: string;
        dateStr: string;
        currentShift: any;
        absence: any;
    }) => void;
    setVacancyData: (value: any) => void;
    setShowVacancyModal: (value: boolean) => void;
    setShowConflictModal: (value: boolean) => void;
    setModifiers: (value: { plannedNovedad: string }) => void;
    setFrancoMode: (mode: string) => void;
    setCellEditMode: (value: boolean) => void;
};

export function handlePlanificacionMouseUp({
    columnSelectMode,
    isServiceLocked,
    activeServiceStatusMsg,
    selection,
    displayedEmployees,
    daysInMonth,
    rfzByEmpDate,
    selectedObjective,
    selectedGrupo,
    grupoUnifiedMode,
    pendingChanges,
    shiftsMap,
    cellTurnosMap,
    absencesMap,
    empDefaultPos,
    dominantPositionName,
    currentDate,
    correctionMode,
    publishStatusMap,
    getObjectiveName,
    isPlanningDateLocked,
    findNeighbors,
    setIsDragging,
    clearLongPressTimer,
    setSelection,
    setActivePosition,
    setSelectedCell,
    setVacancyData,
    setShowVacancyModal,
    setShowConflictModal,
    setModifiers,
    setFrancoMode,
    setCellEditMode,
}: HandlePlanificacionMouseUpParams): void {
    setIsDragging(false);
    clearLongPressTimer();
    if (columnSelectMode) return;
    if (isServiceLocked) {
        toast.error(activeServiceStatusMsg);
        setSelection({ start: null, end: null });
        return;
    }
    if (selection.start && selection.end && selection.start.r === selection.end.r && selection.start.c === selection.end.c) {
        const emp = displayedEmployees[selection.start.r];
        const day = daysInMonth[selection.start.c];
        const dateStr = getDateKey(day);
        const key = `${emp.id}_${dateStr}`;
        const rfzOnCell = rfzByEmpDate[key];
        const { s: cellS, p: cellP } = resolveCellShiftDisplay(
            emp.id, dateStr, selectedObjective, selectedGrupo, grupoUnifiedMode, pendingChanges, shiftsMap, cellTurnosMap,
        );
        const absence = absencesMap[key];
        if (selection.start.r === selection.end.r && selection.start.c === selection.end.c) {
            setSelection({ start: null, end: null });
        }
        const effectiveShift = pendingChanges[key]?.isDeleted
            ? null
            : ((cellP && !cellP.isDeleted ? cellP : cellS) || (rfzOnCell ? rfzDocToShiftView(rfzOnCell) : null) || shiftsMap[key] || (cellTurnosMap?.[key] && cellTurnosMap[key][0]) || null);
        const effObjId = effectiveShift?.objectiveId;
        if (
            effectiveShift &&
            selectedObjective &&
            !(selectedGrupo && grupoUnifiedMode) &&
            isCrossObjectivePlanningReadOnly(effectiveShift, selectedObjective)
        ) {
            toast.message(`Turno en ${getObjectiveName(effObjId)} — solo lectura en este cronograma.`);
            return;
        }
        const empPreferred = empDefaultPos[`${emp.id}___${selectedObjective}`];
        const defaultPos = effectiveShift?.positionName || empPreferred || dominantPositionName;
        setActivePosition(defaultPos);
        if (isShiftConsolidated(effectiveShift)) {
            setSelectedCell({ empId: emp.id, dateStr, currentShift: effectiveShift, absence });
            return;
        }
        const isLocked = isPlanningDateLocked(dateStr);
        const absenceAlreadyHandled = effectiveShift && ['V', 'L', 'PG', 'A', 'E', 'AA'].includes(effectiveShift.code || '');
        if (!isLocked && ((effectiveShift && absence && !absenceAlreadyHandled) || (effectiveShift && effectiveShift.hasNovedad && !absenceAlreadyHandled))) {
            findNeighbors(effectiveShift, dateStr);
            setSelectedCell({ empId: emp.id, dateStr, currentShift: effectiveShift, absence });
            if (absence && absence.type) {
                setVacancyData({ ...absence, source: 'AUSENCIA', focusDate: dateStr });
                setShowVacancyModal(true);
            } else {
                setShowConflictModal(true);
            }
        } else if (!isLocked && absence && !effectiveShift) {
            setSelectedCell({ empId: emp.id, dateStr, currentShift: effectiveShift, absence });
            setVacancyData({ ...absence, source: 'AUSENCIA', focusDate: dateStr });
            setShowVacancyModal(true);
        } else {
            if (!isLocked) {
                setModifiers({ plannedNovedad: effectiveShift?.plannedNovedad || '' });
                setFrancoMode('NONE');
            }
            const pubKey = planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1);
            setCellEditMode(correctionMode && isPlanificacionPublished(publishStatusMap[pubKey]));
            setSelectedCell({ empId: emp.id, dateStr, currentShift: effectiveShift, absence });
        }
    }
}
