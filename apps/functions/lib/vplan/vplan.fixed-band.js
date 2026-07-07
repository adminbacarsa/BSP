"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFixedBandViolations = detectFixedBandViolations;
const WORK_BANDS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const FRANCO = new Set(['F', 'FF', 'FP', 'FT']);
function normBand(code) {
    const c = code.toUpperCase();
    if (c === 'D12')
        return 'M';
    if (c === 'N12')
        return 'N';
    return c;
}
function detectFixedBandViolations(draft, dateStrs, defaultShiftByEmp, defaultPositionByEmp) {
    const violations = [];
    const byEmp = new Map();
    for (const a of draft.assignments) {
        if (!byEmp.has(a.employeeId))
            byEmp.set(a.employeeId, new Map());
        byEmp.get(a.employeeId).set(a.dateStr, a);
    }
    for (const [empId, fixedRaw] of Object.entries(defaultShiftByEmp)) {
        const fixed = String(fixedRaw || '').toUpperCase();
        if (!WORK_BANDS.has(fixed))
            continue;
        const expectedBand = normBand(fixed);
        const byDate = byEmp.get(empId);
        if (!byDate)
            continue;
        for (const dateStr of dateStrs) {
            const a = byDate.get(dateStr);
            if (!a)
                continue;
            const code = String(a.code || '').toUpperCase();
            if (FRANCO.has(code) || !code)
                continue;
            const actualBand = normBand(code);
            if (actualBand === expectedBand)
                continue;
            violations.push({
                employeeId: empId,
                dateStr,
                expectedBand: fixed,
                actualCode: code,
                positionName: a.positionName || defaultPositionByEmp[empId] || '',
            });
        }
    }
    return violations;
}
//# sourceMappingURL=vplan.fixed-band.js.map