import type { RuleTrigger, ServiceRule } from '@/services/slaService';

export function computeServiceRuleChanges(
    dateStr: string,
    rules: ServiceRule[],
    pendingChanges: Record<string, any>,
    shiftsMap: Record<string, any>,
    employees: any[],
    objectiveId: string,
    changedEmpId?: string,
): Record<string, any> {
    const additions: Record<string, any> = {};
    const getEntry = (empId: string) => {
        const k = `${empId}_${dateStr}`;
        const p = pendingChanges[k];
        if (p) return p.isDeleted ? null : p;
        return shiftsMap[k] ?? null;
    };
    const getCode = (empId: string): string | null => {
        const e = getEntry(empId);
        if (!e) return null;
        return String(e.code || e.type || '').toUpperCase() || null;
    };
    for (const rule of rules) {
        if (!rule.triggers.length) continue;
        if (changedEmpId && !rule.triggers.some((t: RuleTrigger) => t.employeeId === changedEmpId)) continue;
        const fires = rule.triggers.every((t: RuleTrigger) => {
            const code = getCode(t.employeeId);
            if (!code) return false;
            const allowed = (t.shiftCodes?.length ? t.shiftCodes : [t.shiftCode]).map(s => String(s || '').toUpperCase()).filter(Boolean);
            return allowed.includes(code);
        });
        if (!fires) continue;
        for (const action of rule.actions) {
            if (action.type === 'EXCLUDE') {
                for (const emp of employees) {
                    const e = getEntry(emp.id);
                    if (!e) continue;
                    const ec = String(e.code || e.type || '').toUpperCase();
                    const ep = e.positionName || '';
                    if (ep === action.positionName && ec === String(action.shiftCode || '').toUpperCase()) {
                        additions[`${emp.id}_${dateStr}`] = { isDeleted: true };
                    }
                }
            } else if (action.type === 'ASSIGN') {
                if (action.employeeId && action.positionName && action.shiftCode) {
                    const e = getEntry(action.employeeId);
                    const eSaved = shiftsMap[`${action.employeeId}_${dateStr}`];
                    const eCheck = (e && !e.isDeleted && !e._isAutoRotation) ? e : (eSaved && !eSaved.isDeleted ? eSaved : null);
                    if (eCheck && String(eCheck.code || eCheck.type || '').toUpperCase() === String(action.shiftCode || '').toUpperCase()) continue;
                    const assignCode = String(action.shiftCode || '').toUpperCase();
                    const bandClock: Record<string, { start: string; end: string; hours: number }> = {
                        M: { start: '07:00', end: '15:00', hours: 8 },
                        T: { start: '15:00', end: '23:00', hours: 8 },
                        N: { start: '23:00', end: '07:00', hours: 8 },
                        D12: { start: '07:00', end: '19:00', hours: 12 },
                        N12: { start: '19:00', end: '07:00', hours: 12 },
                    };
                    const band = bandClock[assignCode] || { start: '07:00', end: '15:00', hours: 8 };
                    additions[`${action.employeeId}_${dateStr}`] = {
                        ...(eCheck || e || {}),
                        code: action.shiftCode, type: action.shiftCode, name: action.shiftCode,
                        hours: band.hours, startTime: band.start, endTime: band.end,
                        positionName: action.positionName, isTemp: true, isFranco: false,
                        objectiveId: (eCheck || e)?.objectiveId ?? objectiveId,
                        _isAutoRotation: undefined,
                        _isAutoCondition: true,
                    };
                }
            }
        }
    }
    return additions;
}
