import {
    deleteField,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { buildPlanificacionEstadoDocId } from '@/lib/multiempresa';
import type { PlanificacionDotacionMap } from '@/lib/planificacion/planificacionDotacionUtils';

export type ClearPlanificacionObjectivePositionsParams = {
    empresaId: string | null | undefined;
    selectedObjective: string;
    year: number;
    month: number;
    empDefaultPos: Record<string, string>;
    empDefaultShift: Record<string, string>;
    employees: { id: string; planificacionDotacion?: PlanificacionDotacionMap }[];
};

export type ClearPlanificacionObjectivePositionsResult = {
    empDefaultPos: Record<string, string>;
    empDefaultShift: Record<string, string>;
};

export async function clearPlanificacionObjectivePositions({
    empresaId,
    selectedObjective,
    year,
    month,
    empDefaultPos,
    empDefaultShift,
    employees,
}: ClearPlanificacionObjectivePositionsParams): Promise<ClearPlanificacionObjectivePositionsResult> {
    const stateKey = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
    const prefix = `___${selectedObjective}`;
    const newPos = Object.fromEntries(Object.entries(empDefaultPos).filter(([k]) => !k.endsWith(prefix)));
    const newShift = Object.fromEntries(Object.entries(empDefaultShift).filter(([k]) => !k.endsWith(prefix)));

    const batch = writeBatch(db);
    const affected = employees.filter((e) => {
        const cfg = e.planificacionDotacion?.[selectedObjective];
        return !!cfg?.positionName || !!cfg?.shiftCode;
    });
    for (const emp of affected) {
        const nextDotacion: PlanificacionDotacionMap = { ...(emp.planificacionDotacion || {}) };
        delete nextDotacion[selectedObjective];
        batch.update(doc(db, 'empleados', emp.id), { planificacionDotacion: nextDotacion });
    }
    if (empresaId) {
        batch.set(doc(db, 'planificacion_estados', stateKey), {
            empresaId,
            objectiveId: selectedObjective,
            objetivoId: selectedObjective,
            year,
            month,
            año: year,
            mes: month,
            defaultPositionByEmp: {},
            defaultShiftByEmp: {},
        }, { merge: true });
    }
    await batch.commit();

    return { empDefaultPos: newPos, empDefaultShift: newShift };
}

export type SavePlanificacionEmpPositionParams = {
    empresaId: string;
    selectedObjective: string;
    year: number;
    month: number;
    empId: string;
    posName: string | null;
    shiftCode?: string | null;
    empDefaultPos: Record<string, string>;
    empDefaultShift: Record<string, string>;
    employees: { id: string; planificacionDotacion?: PlanificacionDotacionMap }[];
};

export type SavePlanificacionEmpPositionResult = {
    empDefaultPos: Record<string, string>;
    empDefaultShift: Record<string, string>;
};

export async function savePlanificacionEmpPosition({
    empresaId,
    selectedObjective,
    year,
    month,
    empId,
    posName,
    shiftCode,
    empDefaultPos,
    empDefaultShift,
    employees,
}: SavePlanificacionEmpPositionParams): Promise<SavePlanificacionEmpPositionResult> {
    const key = `${empId}___${selectedObjective}`;
    const newPosMap = { ...empDefaultPos };
    if (posName) { newPosMap[key] = posName; } else { delete newPosMap[key]; }
    const newShiftMap = { ...empDefaultShift };
    if (shiftCode) { newShiftMap[key] = shiftCode.toUpperCase(); } else { delete newShiftMap[key]; }

    const emp = employees.find((e) => e.id === empId);
    const nextDotacion: PlanificacionDotacionMap = { ...(emp?.planificacionDotacion || {}) };
    if (posName) {
        nextDotacion[selectedObjective] = {
            positionName: posName,
            ...(shiftCode ? { shiftCode: shiftCode.toUpperCase() } : {}),
        };
    } else {
        delete nextDotacion[selectedObjective];
    }

    await updateDoc(doc(db, 'empleados', empId), {
        planificacionDotacion: nextDotacion,
    });

    const stateKey = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
    const stateRef = doc(db, 'planificacion_estados', stateKey);
    const posField = `defaultPositionByEmp.${empId}`;
    const shiftField = `defaultShiftByEmp.${empId}`;
    const estadoPayload: Record<string, unknown> = {
        [posField]: posName ?? deleteField(),
        [shiftField]: shiftCode ? shiftCode.toUpperCase() : deleteField(),
        empresaId,
        objectiveId: selectedObjective,
        objetivoId: selectedObjective,
        year,
        month,
        año: year,
        mes: month,
    };
    try {
        await updateDoc(stateRef, estadoPayload);
    } catch (e: any) {
        if (e?.code === 'not-found') {
            const createPayload: Record<string, unknown> = {
                empresaId,
                objectiveId: selectedObjective,
                objetivoId: selectedObjective,
                year,
                month,
                año: year,
                mes: month,
                defaultPositionByEmp: posName ? { [empId]: posName } : {},
                defaultShiftByEmp: shiftCode ? { [empId]: shiftCode.toUpperCase() } : {},
            };
            try {
                const legacyId = buildPlanificacionEstadoDocId('', selectedObjective, year, month);
                if (legacyId !== stateKey) {
                    const legacySnap = await getDoc(doc(db, 'planificacion_estados', legacyId));
                    if (legacySnap.exists()) {
                        const ld = legacySnap.data() as Record<string, unknown>;
                        if (ld.publishedAt != null && ld.publishedAt !== '') {
                            createPayload.publishedAt = ld.publishedAt;
                            if (ld.publishedBy != null) createPayload.publishedBy = ld.publishedBy;
                        }
                    }
                }
            } catch {
                // best-effort
            }
            await setDoc(stateRef, createPayload, { merge: true });
        } else if (e?.code === 'permission-denied') {
            console.warn('[plan] planificacion_estados sin permiso (puesto ya guardado en legajo)', e);
        } else {
            console.warn('[plan] overlay mensual puestos', e);
        }
    }

    return { empDefaultPos: newPosMap, empDefaultShift: newShiftMap };
}
