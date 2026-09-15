import { getDateKey } from '@/lib/planificacion/utils';
import { SHIFT_HOURS_LOOKUP } from '@/lib/planificacion/planificacionGridVisuals';
import { PLANNING_NON_BILLABLE_CODES } from '@/lib/planificacion/positionCoverageUnits';
import { checkRestBetweenShifts, getAgreementRestConfig } from '@/lib/planificacion/restBetweenShifts';

export type CheckPlanificacionLaborRulesParams = {
    empId: string;
    targetDate: Date;
    newHours: number;
    proposedShift?: { code: string; startTime?: string; endTime?: string; hours?: number };
    employees: any[];
    absencesMap: Record<string, any>;
    agreements: any[];
    planningLimits: { weekly: number; monthly: number };
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
};

export function checkPlanificacionLaborRules({
    empId,
    targetDate,
    newHours,
    proposedShift,
    employees,
    absencesMap,
    agreements,
    planningLimits,
    pendingChanges,
    shiftsMap,
}: CheckPlanificacionLaborRulesParams): string | null {
    const emp = employees.find((e: any) => e.id === empId);
    if (!emp) return null;
    const dateKey = getDateKey(targetDate);
    const key = `${empId}_${dateKey}`;
    if (absencesMap[key]) {
        return `ALERTA CRÍTICA: El empleado tiene una Ausencia Registrada (${absencesMap[key].type}) para esta fecha.`;
    }
    const rule =
        agreements.find((a: any) => a.name === emp.laborAgreement) ||
        agreements.find((a: any) => a.name === 'General') || {
            maxHoursWeekly: planningLimits.weekly,
            maxHoursMonthly: planningLimits.monthly,
        };
    const limitMonthly = parseInt(String((rule as any).maxHoursMonthly), 10) || planningLimits.monthly;
    const pendingShift = pendingChanges[key];
    const existingShift = shiftsMap[key];
    const finalShift = pendingShift ? (pendingShift.isDeleted ? null : pendingShift) : existingShift;
    if (finalShift && (finalShift.code === 'F' || finalShift.isFranco)) {
        return `ALERTA CRÍTICA: El empleado ya tiene un FRANCO asignado este día.`;
    }
    let monthlyTotal = 0;
    const daysInCurrentMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInCurrentMonth; d++) {
        const checkDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), d);
        const k = `${empId}_${getDateKey(checkDate)}`;
        const p = pendingChanges[k];
        const s = shiftsMap[k];
        const active = p ? (p.isDeleted ? null : p) : s;
        if (!active) continue;
        const activeCode = String(active.code || '').toUpperCase();
        if (PLANNING_NON_BILLABLE_CODES.has(activeCode)) continue;
        monthlyTotal += SHIFT_HOURS_LOOKUP[activeCode] || active.hours || 8;
    }
    if (monthlyTotal + newHours > limitMonthly) {
        return `ALERTA MENSUAL: Límite de ${limitMonthly}hs superado.`;
    }

    const restCfg = getAgreementRestConfig(emp, agreements);
    if (restCfg && proposedShift && String(proposedShift.code || '').toUpperCase() !== 'F') {
        const assignStart: Record<string, string> = {
            M: '07:00', T: '15:00', N: '23:00', D12: '07:00', N12: '19:00',
        };
        const codeU = String(proposedShift.code || 'M').toUpperCase();
        const proposedForRest = {
            code: codeU,
            startTime: proposedShift.startTime || assignStart[codeU] || '07:00',
            endTime: proposedShift.endTime,
            hours: proposedShift.hours ?? newHours,
        };
        const getMergedForRest = (eid: string, ds: string) => {
            const k2 = `${eid}_${ds}`;
            const p2 = pendingChanges[k2];
            const fromPending = p2 && !p2.isDeleted ? p2 : null;
            if (eid === empId && ds === dateKey) {
                return { ...proposedForRest };
            }
            return fromPending || shiftsMap[k2] || null;
        };
        const restMsg = checkRestBetweenShifts({
            empId,
            targetDateStr: dateKey,
            proposed: proposedForRest,
            getShift: getMergedForRest,
            cfg: restCfg,
        });
        if (restMsg) return restMsg;
    }

    return null;
}
