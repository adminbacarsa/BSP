import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { RRHH_ABSENCE_LABEL_TO_CODE } from '@/lib/planificacion/absenceCodes';

export type PlanificacionRRHHFormData = {
    type: string;
    reason: string;
};

export type SubmitPlanificacionRRHHNovedadParams = {
    isServiceLocked: boolean;
    activeServiceStatusMsg: string;
    selectedCell: { empId: string; dateStr: string } | null;
    rrhhData: PlanificacionRRHHFormData;
    employees: any[];
    setPendingChanges: Dispatch<SetStateAction<Record<string, any>>>;
    setPendingNovedades: Dispatch<SetStateAction<Record<string, any>>>;
    setShowRRHHModal: (value: boolean) => void;
    setSelectedCell: (value: null) => void;
};

export function submitPlanificacionRRHHNovedad({
    isServiceLocked,
    activeServiceStatusMsg,
    selectedCell,
    rrhhData,
    employees,
    setPendingChanges,
    setPendingNovedades,
    setShowRRHHModal,
    setSelectedCell,
}: SubmitPlanificacionRRHHNovedadParams): void {
    if (isServiceLocked) {
        toast.error(activeServiceStatusMsg);
        return;
    }
    if (!selectedCell) return;
    const code = RRHH_ABSENCE_LABEL_TO_CODE[rrhhData.type] || 'AA';
    const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
    const empName = employees.find((e: any) => e.id === selectedCell.empId)?.name || '';
    setPendingChanges(prev => ({
        ...prev,
        [key]: {
            code,
            name: rrhhData.type,
            isTemp: true,
            isNovedad: true,
            hours: 0,
            startTime: '00:00',
        },
    }));
    setPendingNovedades(prev => ({
        ...prev,
        [key]: {
            employeeId: selectedCell.empId,
            employeeName: empName,
            startDate: selectedCell.dateStr,
            endDate: selectedCell.dateStr,
            type: rrhhData.type,
            reason: rrhhData.reason,
            status: 'APPROVED',
        },
    }));
    toast.success('Novedad pendiente — recordá guardar los cambios');
    setShowRRHHModal(false);
    setSelectedCell(null);
}
