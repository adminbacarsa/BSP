import { toast } from 'sonner';

export type PlanificacionPendingAssignment = {
    shiftConfig: any;
    positionName: string;
    targetDate?: Date;
} | null;

export type ConfirmPlanificacionPendingAssignmentParams = {
    pendingAssignment: PlanificacionPendingAssignment;
    francoMode: string;
    canAssignFT: boolean;
    plannedNovedad: unknown;
    applyToPending: (config: any) => void;
    setFrancoMode: (mode: string) => void;
    setPendingAssignment: (value: null) => void;
    setAuthWarningMessage: (msg: string) => void;
};

export function resetPlanificacionPendingAssignment(
    setPendingAssignment: (value: null) => void,
    setAuthWarningMessage: (msg: string) => void,
): void {
    setPendingAssignment(null);
    setAuthWarningMessage('');
}

export function confirmPlanificacionPendingAssignment({
    pendingAssignment,
    francoMode,
    canAssignFT,
    plannedNovedad,
    applyToPending,
    setFrancoMode,
    setPendingAssignment,
    setAuthWarningMessage,
}: ConfirmPlanificacionPendingAssignmentParams): void {
    if (!pendingAssignment) return;
    if (francoMode === 'FT_SELECTION' && !canAssignFT) {
        toast.error('Sin permiso para asignar Franco Trabajado (FT). Activá «Franco FT» en el rol de Planificación.');
        setFrancoMode('NONE');
        resetPlanificacionPendingAssignment(setPendingAssignment, setAuthWarningMessage);
        return;
    }
    applyToPending({
        ...pendingAssignment.shiftConfig,
        positionName: pendingAssignment.positionName,
        isFrancoTrabajado: francoMode === 'FT_SELECTION',
        isExtended: false,
        isEarlyStart: false,
        plannedNovedad,
    });
    resetPlanificacionPendingAssignment(setPendingAssignment, setAuthWarningMessage);
}
