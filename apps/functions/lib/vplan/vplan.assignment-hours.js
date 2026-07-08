"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAssignmentBillableHours = resolveAssignmentBillableHours;
exports.countDraftBillableHours = countDraftBillableHours;
exports.normalizeAssignmentBillableHours = normalizeAssignmentBillableHours;
const vplan_cycle_templates_1 = require("./vplan.cycle-templates");
const vplan_positions_1 = require("./vplan.positions");
const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR', 'V', 'L', 'A', 'E', 'PG', 'AA']);
function shiftForCode(positions, positionName, code) {
    const posName = String(positionName || '').trim();
    if (!posName || !positions?.length)
        return undefined;
    const pos = positions.find((p) => p.positionName === posName);
    if (!pos)
        return undefined;
    return (pos.shifts || []).find((s) => String(s.code || '').toUpperCase() === code.toUpperCase());
}
function resolveAssignmentBillableHours(a, opts) {
    const code = String(a.code || '').toUpperCase();
    if (!code || NON_BILLABLE.has(code))
        return 0;
    const stored = Number(a.hours);
    if (Number.isFinite(stored) && stored > 0)
        return stored;
    const shift = shiftForCode(opts?.positions, a.positionName, code);
    if (shift)
        return (0, vplan_positions_1.shiftBandHours)(shift);
    return (0, vplan_cycle_templates_1.billableHoursForCode)(code, opts?.cycle);
}
function countDraftBillableHours(assignments, opts) {
    let total = 0;
    for (const a of assignments) {
        total += resolveAssignmentBillableHours(a, opts);
    }
    return Math.round(total);
}
function normalizeAssignmentBillableHours(assignments, opts) {
    const log = [];
    const next = assignments.map((a) => {
        const code = String(a.code || '').toUpperCase();
        if (!code || NON_BILLABLE.has(code))
            return a;
        const stored = Number(a.hours);
        if (Number.isFinite(stored) && stored > 0)
            return a;
        const hours = resolveAssignmentBillableHours(a, opts);
        if (hours <= 0)
            return a;
        log.push({
            code: 'HOURS_NORMALIZE',
            message: `${code} hours ${stored || 0} → ${hours} (${a.dateStr})`,
            employeeId: a.employeeId,
            dateStr: a.dateStr,
        });
        return { ...a, hours };
    });
    return { assignments: next, log };
}
//# sourceMappingURL=vplan.assignment-hours.js.map