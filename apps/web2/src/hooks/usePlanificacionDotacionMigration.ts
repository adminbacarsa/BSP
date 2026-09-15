import { useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { PlanificacionDotacionMap } from '@/lib/planificacion/planificacionDotacionUtils';

export type PlanificacionDotacionMigrationParams = {
    employees: { id: string; planificacionDotacion?: PlanificacionDotacionMap }[];
};

export function usePlanificacionDotacionMigration({ employees }: PlanificacionDotacionMigrationParams) {
    const dotacionMigratedRef = useRef(false);

    useEffect(() => {
        if (dotacionMigratedRef.current || typeof window === 'undefined' || !employees.length) return;
        dotacionMigratedRef.current = true;
        try {
            const lsPos: Record<string, string> = JSON.parse(localStorage.getItem('planif_emp_pos') || '{}');
            const lsShift: Record<string, string> = JSON.parse(localStorage.getItem('planif_emp_shift') || '{}');
            const allKeys = new Set([...Object.keys(lsPos), ...Object.keys(lsShift)]);
            for (const key of allKeys) {
                const sep = key.indexOf('___');
                if (sep <= 0) continue;
                const empId = key.slice(0, sep);
                const objId = key.slice(sep + 3);
                const emp = employees.find((e) => e.id === empId);
                if (!emp) continue;
                const existing = emp.planificacionDotacion?.[objId]?.positionName;
                const positionName = lsPos[key];
                if (existing || !positionName) continue;
                const nextDotacion: PlanificacionDotacionMap = { ...(emp.planificacionDotacion || {}) };
                nextDotacion[objId] = {
                    positionName,
                    ...(lsShift[key] ? { shiftCode: lsShift[key] } : {}),
                };
                updateDoc(doc(db, 'empleados', empId), { planificacionDotacion: nextDotacion }).catch(() => {});
            }
        } catch { /* noop */ }
    }, [employees]);
}
