"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countMissingCoverageSlots = countMissingCoverageSlots;
exports.buildCoverageGuard = buildCoverageGuard;
exports.wouldReduceCoverageByForcingFranco = wouldReduceCoverageByForcingFranco;
const vplan_coverage_audit_1 = require("./vplan.coverage-audit");
function countMissingCoverageSlots(assignments, draftMeta, guard) {
    const audit = (0, vplan_coverage_audit_1.buildDetailedCoverageAudit)({
        draft: { ...draftMeta, assignments },
        demand: guard.demand,
        positions: guard.positions,
        defaultPositionByEmp: guard.defaultPositionByEmp,
        dateStrs: guard.dateStrList,
        cycle: guard.cycle,
        previousMonthAssignments: guard.previousMonthAssignments,
    });
    return audit.totalMissingSlots;
}
function buildCoverageGuard(opts) {
    return {
        protect: opts.protect,
        demand: opts.demand,
        positions: opts.positions,
        defaultPositionByEmp: opts.defaultPositionByEmp,
        dateStrList: opts.dateStrList,
        cycle: opts.cycle,
        previousMonthAssignments: opts.previousMonthAssignments,
    };
}
function wouldReduceCoverageByForcingFranco(opts) {
    const before = countMissingCoverageSlots(opts.assignments, opts.draftMeta, opts.guard);
    const idx = opts.assignments.findIndex((a) => a.employeeId === opts.empId && a.dateStr === opts.dateStr);
    if (idx < 0)
        return false;
    const next = opts.assignments.map((a) => ({ ...a }));
    const cell = next[idx];
    const newCode = (opts.proposedCode ?? 'F').toUpperCase();
    next[idx] = {
        ...cell,
        code: newCode,
        positionName: newCode === 'F' ? '' : cell.positionName,
        hours: newCode === 'F' ? 0 : cell.hours,
    };
    const after = countMissingCoverageSlots(next, opts.draftMeta, opts.guard);
    return after > before;
}
//# sourceMappingURL=vplan.coverage-guard.js.map