import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
    buildDotacionMapsFromEmployees,
} from '@/lib/planificacion/planificacionDotacionUtils';
import {
    buildPlanificacionEstadoDocId,
    fetchMergedPlanificacionEstadoData,
} from '@/lib/multiempresa';

export type PlanificacionDotacionOverlayParams = {
    employees: { id: string; planificacionDotacion?: Record<string, unknown> }[];
    selectedObjective: string;
    currentDate: Date;
    empresaId: string | null | undefined;
    setEmpDefaultPos: Dispatch<SetStateAction<Record<string, string>>>;
    setEmpDefaultShift: Dispatch<SetStateAction<Record<string, string>>>;
};

export function usePlanificacionDotacionOverlay({
    employees,
    selectedObjective,
    currentDate,
    empresaId,
    setEmpDefaultPos,
    setEmpDefaultShift,
}: PlanificacionDotacionOverlayParams) {
    useEffect(() => {
        const { pos: basePos, shift: baseShift } = buildDotacionMapsFromEmployees(employees);
        setEmpDefaultPos(basePos);
        setEmpDefaultShift(baseShift);
        if (!selectedObjective) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const stateKey = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
        const applyOverlay = (monthlyPos: Record<string, string>, monthlyShift: Record<string, string>) => {
            if (Object.keys(monthlyPos).length === 0) return false;
            const merged = { ...basePos };
            const mergedS = { ...baseShift };
            for (const [id, p] of Object.entries(monthlyPos)) merged[`${id}___${selectedObjective}`] = p;
            for (const [id, s] of Object.entries(monthlyShift)) mergedS[`${id}___${selectedObjective}`] = s;
            setEmpDefaultPos(merged);
            setEmpDefaultShift(mergedS);
            return true;
        };
        fetchMergedPlanificacionEstadoData(empresaId, selectedObjective, year, month).then((d) => {
            if (applyOverlay(
                (d.defaultPositionByEmp as Record<string, string>) || {},
                (d.defaultShiftByEmp as Record<string, string>) || {},
            )) return;
            const prevMonth = month === 1 ? 12 : month - 1;
            const prevYear = month === 1 ? year - 1 : year;
            fetchMergedPlanificacionEstadoData(empresaId, selectedObjective, prevYear, prevMonth).then((prev) => {
                const prevPos: Record<string, string> = (prev.defaultPositionByEmp as Record<string, string>) || {};
                const prevSh: Record<string, string> = (prev.defaultShiftByEmp as Record<string, string>) || {};
                if (applyOverlay(prevPos, prevSh)) {
                    if (empresaId) {
                        setDoc(doc(db, 'planificacion_estados', stateKey), {
                            empresaId,
                            objectiveId: selectedObjective,
                            objetivoId: selectedObjective,
                            year,
                            month,
                            año: year,
                            mes: month,
                            defaultPositionByEmp: prevPos,
                            defaultShiftByEmp: prevSh,
                        }, { merge: true }).catch(() => {});
                    }
                }
            }).catch(() => {});
        }).catch(() => {});
    }, [employees, selectedObjective, currentDate, empresaId, setEmpDefaultPos, setEmpDefaultShift]);
}
