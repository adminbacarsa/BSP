import { getDateKey } from './utils';
import { SHIFT_HOURS_LOOKUP } from './constants';
export const checkLaborRules = (empId: string, targetDate: Date, newHours: number, employees: any[], agreements: any[], pendingChanges: any, shiftsMap: any, absencesMap: any) => {
    const emp = employees.find(e => e.id === empId); if (!emp) return null;
    const key = empId + '_' + getDateKey(targetDate);
    if (absencesMap[key]) return 'ALERTA: Ausencia Registrada.';
    if (shiftsMap[key]?.code === 'F') return 'ALERTA: Franco Asignado.';
    return null;
};