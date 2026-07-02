"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanDeterministicFixer = runVplanDeterministicFixer;
const HARD_MAX_CCT_HOURS = 200;
const BILLABLE = new Set(['M', 'T', 'N', 'D12', 'N12']);
function runVplanDeterministicFixer(draft) {
    const log = [];
    const hoursByEmp = {};
    for (const a of draft.assignments) {
        const code = a.code.toUpperCase();
        if (!BILLABLE.has(code))
            continue;
        hoursByEmp[a.employeeId] = (hoursByEmp[a.employeeId] || 0) + (a.hours ?? 8);
    }
    const assignments = draft.assignments.map((a) => {
        const code = a.code.toUpperCase();
        if (!BILLABLE.has(code))
            return a;
        const used = hoursByEmp[a.employeeId] || 0;
        if (used <= HARD_MAX_CCT_HOURS)
            return a;
        hoursByEmp[a.employeeId] = used - (a.hours ?? 8);
        log.push({
            code: 'CCT_CAP',
            message: `Turno ${code} → F por tope ${HARD_MAX_CCT_HOURS}h ciclo`,
            employeeId: a.employeeId,
            dateStr: a.dateStr,
        });
        return { ...a, code: 'F', hours: 0, positionName: a.positionName || '' };
    });
    return {
        draft: { ...draft, assignments },
        log,
    };
}
//# sourceMappingURL=phase8-fix.js.map