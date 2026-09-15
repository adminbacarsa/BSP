import { toast } from 'sonner';
import { SHIFT_HOURS_LOOKUP, SHIFT_RANGES } from '@/lib/planificacion/planificacionGridVisuals';
import { isShiftConsolidated } from '@/lib/planificacion/planificacionShiftViewUtils';
import { PLANNING_NON_BILLABLE_CODES } from '@/lib/planificacion/positionCoverageUnits';

export function getPlanificacionShiftFor(
    empId: string,
    dateStr: string,
    pendingChanges: Record<string, any>,
    shiftsMap: Record<string, any>,
): any | null {
    const k = `${empId}_${dateStr}`;
    const pending = pendingChanges[k];
    if (pending) return pending.isDeleted ? null : pending;
    return shiftsMap[k] || null;
}

export function toPlanificacionChangeConfig(
    shift: any,
    activePosition: string | null,
    dominantPositionName?: string | null,
) {
    const code = (shift?.code || shift?.type || '').toString().toUpperCase();
    const hours = Number(shift?.hours) || SHIFT_HOURS_LOOKUP[code] || 8;
    const startTime = typeof shift?.startTime === 'string'
        ? shift.startTime
        : (SHIFT_RANGES[code]?.split?.('-')?.[0]?.trim?.() || '07:00');
    return {
        code: shift?.code || code,
        name: shift?.name || shift?.type || shift?.code || code,
        hours,
        startTime,
        positionName: shift?.positionName || activePosition || dominantPositionName || 'General',
        isFranco: shift?.code === 'F' || shift?.isFranco || false,
        isFrancoTrabajado: !!shift?.isFrancoTrabajado,
        isFrancoCompensatorio: !!shift?.isFrancoCompensatorio,
        plannedNovedad: shift?.plannedNovedad || null,
        isExtended: !!shift?.isExtended,
        isEarlyStart: !!shift?.isEarlyStart,
    };
}

export type ExecutePlanificacionSwapParams = {
    isServiceLocked: boolean;
    activeServiceStatusMsg: string;
    selectedCell: { empId: string; dateStr: string } | null;
    selectedSwapTarget: string;
    selectedSwapDate: string;
    currentDate: Date;
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    employees: any[];
    activePosition: string | null;
    dominantPositionName?: string | null;
    commitPendingChanges: (changes: Record<string, any>) => void;
    setShowSwapModal: (value: boolean) => void;
    setSwapConfig: (value: null) => void;
    setCoverageStep: (value: boolean) => void;
    setSelectedSwapTarget: (value: string) => void;
    setSelectedSwapDate: (value: string) => void;
    setSwapSearchTerm: (value: string) => void;
};

export function executePlanificacionSwap({
    isServiceLocked,
    activeServiceStatusMsg,
    selectedCell,
    selectedSwapTarget,
    selectedSwapDate,
    currentDate,
    pendingChanges,
    shiftsMap,
    employees,
    activePosition,
    dominantPositionName,
    commitPendingChanges,
    setShowSwapModal,
    setSwapConfig,
    setCoverageStep,
    setSelectedSwapTarget,
    setSelectedSwapDate,
    setSwapSearchTerm,
}: ExecutePlanificacionSwapParams): void {
    if (isServiceLocked) {
        toast.error(activeServiceStatusMsg || 'Bloqueado');
        return;
    }
    if (!selectedCell?.empId || !selectedCell?.dateStr || !selectedSwapTarget) return;

    const emp1 = selectedCell.empId;
    const date1 = selectedCell.dateStr;
    const emp2 = selectedSwapTarget;
    const date2 = selectedSwapDate || date1;

    const inCurrentMonth = (dateStr: string) => {
        const [y, m] = dateStr.split('-').map(Number);
        return y === currentDate.getFullYear() && m === (currentDate.getMonth() + 1);
    };
    if (!inCurrentMonth(date1) || !inCurrentMonth(date2)) {
        toast.error('El intercambio debe realizarse dentro del mes en curso.');
        return;
    }

    const getShiftFor = (empId: string, dateStr: string) =>
        getPlanificacionShiftFor(empId, dateStr, pendingChanges, shiftsMap);
    const toChangeConfig = (shift: any) =>
        toPlanificacionChangeConfig(shift, activePosition, dominantPositionName);

    const shift1 = getShiftFor(emp1, date1);
    const shift2 = getShiftFor(emp2, date2);
    if (!shift1 || !shift2) {
        toast.error('Ambos empleados deben tener turno en ese día');
        return;
    }
    if ([shift1, shift2].some((s: any) => isShiftConsolidated(s))) {
        toast.error('No se puede intercambiar: hay celdas consolidadas/fichadas.');
        return;
    }

    const name1 = employees.find(e => e.id === emp1)?.name || 'Emp1';
    const name2 = employees.find(e => e.id === emp2)?.name || 'Emp2';

    const newChanges = { ...pendingChanges };

    const isFrancoLike = (s: any) => {
        const code = String(s?.code || s?.type || '').toUpperCase();
        return code === 'F' || code === 'FF' || !!s?.isFranco;
    };
    const isWorkingCode = (code: string) => !PLANNING_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());

    if (isFrancoLike(shift1) && isFrancoLike(shift2)) {
        if (date2 === date1) {
            toast.error('Para Franco ↔ Franco seleccioná un día distinto del compañero.');
            return;
        }
        const emp2AtDate1 = getShiftFor(emp2, date1);
        const emp1AtDate2 = getShiftFor(emp1, date2);
        if (!emp2AtDate1 || !emp1AtDate2) {
            toast.error('Para Franco ↔ Franco ambos deben tener turnos asignados en las dos fechas.');
            return;
        }
        if (!isWorkingCode(emp2AtDate1.code) || !isWorkingCode(emp1AtDate2.code)) {
            toast.error('Para Franco ↔ Franco se requiere que en las fechas cruzadas haya turnos laborables (no licencias/francos).');
            return;
        }
        if ([emp2AtDate1, emp1AtDate2].some((s: any) => isShiftConsolidated(s))) {
            toast.error('No se puede intercambiar: hay celdas consolidadas/fichadas.');
            return;
        }

        newChanges[`${emp1}_${date1}`] = { ...toChangeConfig(emp2AtDate1), isTemp: true, isSwap: true, swapWith: name2, swapDate: date2 };
        newChanges[`${emp2}_${date1}`] = { ...toChangeConfig(shift1), isTemp: true, isSwap: true, swapWith: name1, swapDate: date1 };
        newChanges[`${emp2}_${date2}`] = { ...toChangeConfig(emp1AtDate2), isTemp: true, isSwap: true, swapWith: name1, swapDate: date1 };
        newChanges[`${emp1}_${date2}`] = { ...toChangeConfig(shift2), isTemp: true, isSwap: true, swapWith: name2, swapDate: date2 };
    } else {
        newChanges[`${emp1}_${date1}`] = { ...toChangeConfig(shift2), isTemp: true, isSwap: true, swapWith: name2, swapDate: date2 };
        newChanges[`${emp2}_${date2}`] = { ...toChangeConfig(shift1), isTemp: true, isSwap: true, swapWith: name1, swapDate: date1 };
    }
    commitPendingChanges(newChanges);

    setShowSwapModal(false);
    setSwapConfig(null);
    setCoverageStep(false);
    setSelectedSwapTarget('');
    setSelectedSwapDate('');
    setSwapSearchTerm('');
    toast.success('Enroque completado');
}
