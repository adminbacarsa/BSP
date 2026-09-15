import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
    fetchPlanificacionEstadoDoc,
    planificacionPublishLookupKey,
} from '@/lib/multiempresa';
import { isPlanificacionPublished } from '@/lib/planificacion/planificacionPlanningShiftRules';

export type PlanificacionPublishStateParams = {
    selectedObjective: string;
    currentDate: Date;
    empresaId: string | null | undefined;
    dataRefreshNonce: number;
    publishStatusMap: Record<string, { publishedAt: unknown; publishedBy: string } | null>;
    setPublishStatusMap: Dispatch<SetStateAction<Record<string, { publishedAt: unknown; publishedBy: string } | null>>>;
    setMesRotacionesDesactivadas: Dispatch<SetStateAction<Set<string>>>;
    rfzTodos: any[];
    canCorrectPlanning: boolean;
    setNeedsRepublishMap: Dispatch<SetStateAction<Record<string, boolean>>>;
    setCorrectionMode: Dispatch<SetStateAction<boolean>>;
};

export function usePlanificacionPublishState({
    selectedObjective,
    currentDate,
    empresaId,
    dataRefreshNonce,
    publishStatusMap,
    setPublishStatusMap,
    setMesRotacionesDesactivadas,
    rfzTodos,
    canCorrectPlanning,
    setNeedsRepublishMap,
    setCorrectionMode,
}: PlanificacionPublishStateParams) {
    useEffect(() => {
        if (!selectedObjective) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        fetchPlanificacionEstadoDoc(empresaId, selectedObjective, year, month)
            .then(row => {
                if (row && row.data.publishedAt) {
                    setPublishStatusMap(prev => ({
                        ...prev,
                        [lookupKey]: {
                            publishedAt: row.data.publishedAt,
                            publishedBy: String(row.data.publishedBy ?? ''),
                        },
                    }));
                } else {
                    setPublishStatusMap(prev => ({ ...prev, [lookupKey]: null }));
                }
                const disabled = (row?.data.rotacionesDesactivadasMes as string[] | undefined) ?? [];
                setMesRotacionesDesactivadas(new Set(disabled));
            }).catch(() => { setMesRotacionesDesactivadas(new Set()); });
    }, [selectedObjective, currentDate, empresaId, dataRefreshNonce, setPublishStatusMap, setMesRotacionesDesactivadas]);

    const activateRfzCorrectionFlow = useCallback((opts?: { republishOnly?: boolean }) => {
        if (!selectedObjective) return;
        const lookupKey = planificacionPublishLookupKey(
            selectedObjective,
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
        );
        if (!isPlanificacionPublished(publishStatusMap[lookupKey])) return;
        setNeedsRepublishMap(prev => ({ ...prev, [lookupKey]: true }));
        if (!opts?.republishOnly && canCorrectPlanning) setCorrectionMode(true);
    }, [selectedObjective, currentDate, publishStatusMap, canCorrectPlanning, setNeedsRepublishMap, setCorrectionMode]);

    useEffect(() => {
        if (!selectedObjective) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        if (!isPlanificacionPublished(publishStatusMap[lookupKey])) return;
        const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
        const draftRfz = rfzTodos.filter(rfz =>
            rfz.objectiveId === selectedObjective &&
            String(rfz.fecha || '').startsWith(monthPrefix) &&
            rfz.draft === true,
        );
        if (draftRfz.length === 0) return;
        const asignadosSinPublicar = draftRfz.some(rfz => rfz.employeeId && rfz.employeeId !== 'VACANTE');
        if (asignadosSinPublicar) {
            setNeedsRepublishMap(prev => ({ ...prev, [lookupKey]: true }));
        }
        if (canCorrectPlanning) setCorrectionMode(true);
    }, [selectedObjective, currentDate, rfzTodos, publishStatusMap, canCorrectPlanning, setNeedsRepublishMap, setCorrectionMode]);

    return { activateRfzCorrectionFlow };
}
