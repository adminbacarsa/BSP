import { getDayLetter } from './utils';
import { SHIFT_HOURS_LOOKUP } from './constants';
export const calculateCoverageStats = (dateStr: string, posName: string, structure: any[], emps: any[], changes: any, existing: any, objectiveId: string) => {
    const pos = structure.find(p => p.positionName === posName) || { qty: 1, coverageType: '24hs' };
    const pax = Number(pos.qty) || 1;
    const active = pos.activeDays ? pos.activeDays.includes(getDayLetter(dateStr)) : true;
    let target = active ? (pos.coverageType === '24hs' ? 24 * pax : 8 * pax) : 0;
    let current = 0;
    emps.forEach(emp => {
        const key = emp.id + '_' + dateStr;
        const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
        if (shift && (shift.objectiveId === objectiveId || changes[key])) {
            if (!['F','FF','V','L'].includes(shift.code)) current += (SHIFT_HOURS_LOOKUP[shift.code] || 8);
        }
    });
    return { current, target, pax, active };
};