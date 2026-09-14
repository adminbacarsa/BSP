import { toast } from 'sonner';
import { isPosExcludedOnDate } from '@/lib/planificacion/planificacionDailyCoverage';
import {
    isPlanningShiftExcludedOnDate,
    isPlanningWorkShiftCode,
    planningPositionExclusionLabel,
} from '@/lib/slaPlanningMatch';
import { isShiftConsolidated } from '@/lib/planificacion/planificacionShiftViewUtils';
import { shiftPlanningCodeUpper } from '@/lib/planificacion/planificacionPlanningShiftRules';

export type AssignPlanificacionShiftParams = {
    shiftConfig: any;
    positionName: string;
    isServiceLocked: boolean;
    activeServiceStatusMsg: string;
    selectedCell: {
        empId: string;
        dateStr: string;
        currentShift?: any;
        absence?: unknown;
    } | null;
    isPlanningDateLocked: (dateStr: string) => boolean;
    positionStructure: any[];
    correctionMode: boolean;
    francoMode: string;
    canAssignFT: boolean;
    setFrancoMode: (mode: string) => void;
    selectedObjective: string;
    getObjectiveName: (objectiveId: string) => string;
    applyToPending: (config: any) => void;
    checkLaborRules: (
        empId: string,
        targetDate: Date,
        hours: number,
        shift: { code?: string; startTime?: string; endTime?: string; hours?: number },
    ) => string | null;
    planningLimits: { monthly: number };
    employees: any[];
    plannedNovedad: unknown;
    setAuthWarningMessage: (msg: string) => void;
    setPendingAssignment: (value: {
        shiftConfig: any;
        positionName: string;
        targetDate: Date;
    } | null) => void;
};

export function assignPlanificacionShift({
    shiftConfig,
    positionName,
    isServiceLocked,
    activeServiceStatusMsg,
    selectedCell,
    isPlanningDateLocked,
    positionStructure,
    correctionMode,
    francoMode,
    canAssignFT,
    setFrancoMode,
    selectedObjective,
    getObjectiveName,
    applyToPending,
    checkLaborRules,
    planningLimits,
    employees,
    plannedNovedad,
    setAuthWarningMessage,
    setPendingAssignment,
}: AssignPlanificacionShiftParams): void {
    if (isServiceLocked) { toast.error(activeServiceStatusMsg || 'Bloqueado'); return; }
    if (!selectedCell) return;
    if (isPlanningDateLocked(selectedCell.dateStr)) {
        const c = String(shiftConfig.code || '').toUpperCase();
        if (!['RET', 'ESC', 'F', 'FF', 'FP', 'FT'].includes(c)) {
            toast.error('Periodo cerrado — solo podés asignar RET, ESC o Franco.');
            return;
        }
    }
    if (isShiftConsolidated(selectedCell.currentShift)) {
        toast.warning('Turno consolidado/fichado: solo lectura.');
        return;
    }
    if (selectedCell.absence) {
        toast.warning('El empleado tiene una ausencia/vacaciones registrada: no se puede planificar encima.');
        return;
    }
    const posCfg = positionStructure.find((p: any) => p.positionName === positionName);
    if (isPosExcludedOnDate(posCfg, selectedCell.dateStr) && isPlanningWorkShiftCode(shiftConfig.code)) {
        toast.error(`Puesto "${positionName}" excluido por SLA (${planningPositionExclusionLabel(selectedCell.dateStr)}). Configurado en Servicios.`, { duration: 9000 });
        return;
    }
    if (isPlanningShiftExcludedOnDate(posCfg, selectedCell.dateStr, shiftConfig.code)) {
        toast.error(
            `Turno ${String(shiftConfig.code || '').toUpperCase()} excluido por SLA en "${positionName}" (${planningPositionExclusionLabel(selectedCell.dateStr)}).`,
            { duration: 9000 },
        );
        return;
    }
    const existingCode = String(selectedCell.currentShift?.code || selectedCell.currentShift?.type || '').toUpperCase();
    if (['V', 'L', 'A', 'E', 'AA'].includes(existingCode)) {
        toast.warning('Novedad RRHH (ausencia/vacaciones/licencia): no se puede planificar encima.');
        return;
    }
    const existing = selectedCell.currentShift;
    const isFT = !correctionMode && francoMode === 'FT_SELECTION';
    if (isFT && !canAssignFT) {
        toast.error('Sin permiso para asignar Franco Trabajado (FT). Activá «Franco FT» en el rol de Planificación.');
        setFrancoMode('NONE');
        return;
    }
    const newAssignCode = String(shiftConfig.code || '').toUpperCase();
    if (
        existing
        && existing.objectiveId != null
        && existing.objectiveId !== ''
        && String(existing.objectiveId) !== String(selectedObjective)
        && !existing.isFranco
        && !isFT
    ) {
        const existingObjCode = shiftPlanningCodeUpper(existing);
        if (existingObjCode === 'RET') {
            applyToPending({ ...shiftConfig, positionName, objectiveId: selectedObjective });
            return;
        }
        if (newAssignCode === 'RET') {
            toast.error(
                `Ese día tiene turno en ${getObjectiveName(existing.objectiveId)}. No podés asignar RET en este objetivo sin mover el turno laboral.`,
                { duration: 9000 },
            );
            return;
        }
        const objName = getObjectiveName(existing.objectiveId);
        if (!confirm(`⚠️ ALERTA DE TRANSFERENCIA\n\nEl empleado ya tiene turno en "${objName}".\n\n¿Desea moverlo a este objetivo?`)) return;
        applyToPending({ ...shiftConfig, oldObjectiveId: existing.objectiveId, positionName });
        return;
    }
    if (!correctionMode && existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F' && !isFT) {
        if (!confirm('⚠️ ATENCIÓN: ESTÁ ELIMINANDO UN FRANCO\n\n¿Seguro que desea eliminar el Franco?')) return;
    }
    if (correctionMode && existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') {
        if (!confirm('⚠️ MODO CORRECCIÓN: Vas a reemplazar un Franco publicado.\n\n¿Confirmar corrección directa?')) return;
    }
    const [y, m, d] = selectedCell.dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    const hours = shiftConfig.hours != null ? shiftConfig.hours : 8;
    if (shiftConfig.code !== 'F' && !isFT && !correctionMode) {
        const warning = checkLaborRules(selectedCell.empId, targetDate, hours, {
            code: shiftConfig.code,
            startTime: shiftConfig.startTime,
            endTime: shiftConfig.endTime,
            hours: shiftConfig.hours,
        });
        if (warning) {
            if (warning.includes('CRÍTICA')) { toast.error(warning); return; }
            if (warning.startsWith('ALERTA MENSUAL')) {
                applyToPending({
                    ...shiftConfig,
                    positionName,
                    isFrancoTrabajado: isFT,
                    isFrancoCompensatorio: false,
                    isExtended: false,
                    isEarlyStart: false,
                    plannedNovedad,
                });
                const empName = employees.find((e: any) => e.id === selectedCell.empId)?.name || 'Empleado';
                toast.warning(`${empName} supera ${planningLimits.monthly}h. El PIN se pedirá al guardar.`, { duration: 2000 });
                return;
            }
            setAuthWarningMessage(warning);
            setPendingAssignment({ shiftConfig, positionName, targetDate });
            return;
        }
    }
    applyToPending({
        ...shiftConfig,
        positionName,
        isFrancoTrabajado: isFT,
        isFrancoCompensatorio: false,
        isExtended: false,
        isEarlyStart: false,
        plannedNovedad,
    });
}
