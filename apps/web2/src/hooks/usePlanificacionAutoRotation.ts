import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { computeServiceRuleChanges } from '@/lib/planificacion/planificacionServiceRuleChanges';
import { applyRotationsForMonth } from '@/lib/planificacion/slaRotationMonthPlanner';
import type { GrupoObjetivos } from '@/services/gruposService';
import type { ServiceRotation, ServiceRule } from '@/services/slaService';

export type PlanificacionAutoRotationParams = {
    shiftsMapLoaded: boolean;
    activeSlaServiceRotations: ServiceRotation[] | null;
    selectedObjective: string;
    hasActiveSLA: boolean;
    currentDate: Date;
    shiftsMap: Record<string, any>;
    selectedGrupo: GrupoObjetivos | null;
    grupoUnifiedMode: boolean;
    mesRotacionesDesactivadas: Set<string>;
    positionStructure: any[];
    activeSlaServiceRules: ServiceRule[] | null;
    employees: any[];
    commitPendingChanges: (
        updater: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>),
    ) => void;
};

export function usePlanificacionAutoRotation({
    shiftsMapLoaded,
    activeSlaServiceRotations,
    selectedObjective,
    hasActiveSLA,
    currentDate,
    shiftsMap,
    selectedGrupo,
    grupoUnifiedMode,
    mesRotacionesDesactivadas,
    positionStructure,
    activeSlaServiceRules,
    employees,
    commitPendingChanges,
}: PlanificacionAutoRotationParams) {
    const autoRotAppliedRef = useRef<string>('');

    const resetAutoRotAppliedGuard = useCallback(() => {
        autoRotAppliedRef.current = '';
    }, []);

    useEffect(() => {
        autoRotAppliedRef.current = '';
    }, [selectedObjective, currentDate.getFullYear(), currentDate.getMonth()]);

    useEffect(() => {
        if (!shiftsMapLoaded) return;
        if (!activeSlaServiceRotations?.length) return;
        if (!selectedObjective) return;
        if (!hasActiveSLA) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const periodKey = `${selectedObjective}_${year}_${month}`;
        if (autoRotAppliedRef.current === periodKey) return;
        const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
        const grupoObjIds = (selectedGrupo && grupoUnifiedMode && Array.isArray(selectedGrupo.objectiveIds))
            ? (selectedGrupo.objectiveIds as string[])
            : null;
        const hasAnySaved = Object.entries(shiftsMap).some(([k, v]: [string, any]) => {
            if (!k.includes(`_${monthPrefix}`) || v?.isDeleted) return false;
            const objId = v?.objectiveId;
            if (objId === selectedObjective) return true;
            if (grupoObjIds && grupoObjIds.includes(objId)) return true;
            return false;
        });
        if (hasAnySaved) {
            autoRotAppliedRef.current = periodKey;
            return;
        }
        const rotacionesActivas = (activeSlaServiceRotations as any[]).filter(r => !mesRotacionesDesactivadas.has(r.id));
        if (!rotacionesActivas.length) return;
        autoRotAppliedRef.current = periodKey;
        const rotAdditions = applyRotationsForMonth(
            rotacionesActivas, {}, shiftsMap, year, month, positionStructure,
        );
        if (!Object.keys(rotAdditions).length) return;
        if (activeSlaServiceRules?.length && rotacionesActivas.some((r: any) => r.cumplirCondicion)) {
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const condChanges = computeServiceRuleChanges(
                    dateStr, activeSlaServiceRules, rotAdditions, shiftsMap, employees, selectedObjective,
                );
                Object.assign(rotAdditions, condChanges);
            }
        }
        commitPendingChanges((prev: Record<string, any>) => {
            if (Object.values(prev).some((v: any) => v && !v._isAutoRotation && !v._isAutoCondition)) return prev;
            return { ...prev, ...rotAdditions };
        });
        const desactCount = mesRotacionesDesactivadas.size;
        const totalCount = activeSlaServiceRotations.length;
        const hint = desactCount > 0 ? ` (${rotacionesActivas.length}/${totalCount} activas)` : '';
        toast.info(`Rotación pre-cargada${hint} — revisá y guardá cuando estés listo`, { duration: 4000 });
    }, [
        activeSlaServiceRotations,
        mesRotacionesDesactivadas,
        hasActiveSLA,
        shiftsMap,
        shiftsMapLoaded,
        currentDate,
        selectedObjective,
        positionStructure,
        commitPendingChanges,
        activeSlaServiceRules,
        employees,
        selectedGrupo,
        grupoUnifiedMode,
    ]);

    return { resetAutoRotAppliedGuard };
}
