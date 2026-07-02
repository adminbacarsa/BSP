"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runVplanVerification = runVplanVerification;
const autoScheduleEngine_1 = require("../../scheduling/autoScheduleEngine");
const vplan_engine_bridge_1 = require("../vplan.engine-bridge");
function runVplanVerification(opts) {
    const ctx = (0, vplan_engine_bridge_1.buildEngineContext)({
        snapshot: opts.snapshot,
        planningState: opts.planningState,
        prevPlanningState: opts.prevPlanningState,
        strategy: opts.strategy,
    });
    const engineAssignments = opts.draft.assignments.map((a) => ({
        empId: a.employeeId,
        dateStr: a.dateStr,
        positionName: a.positionName,
        code: a.code,
        name: a.code,
        hours: a.hours ?? 0,
        startTime: '00:00',
        isFranco: a.code === 'F' || a.code === 'FF',
    }));
    const coverage = (0, autoScheduleEngine_1.verifyCoverage)(ctx, engineAssignments);
    const issues = [];
    if (coverage.uncoveredSlots > 0) {
        issues.push({
            severity: 'blocking',
            code: 'COVERAGE_GAP',
            message: `${coverage.uncoveredSlots} slots sin cubrir (${coverage.coveredSlots}/${coverage.totalSlots})`,
        });
        for (const [dateStr, gaps] of Object.entries(coverage.uncoveredByDay)) {
            for (const g of gaps.slice(0, 3)) {
                issues.push({
                    severity: 'blocking',
                    code: 'SLOT_MISSING',
                    message: `Faltan ${g.missing}×${g.shiftCode} en ${g.positionName}`,
                    dateStr,
                    positionName: g.positionName,
                });
            }
        }
    }
    const hoursGap = Math.round(coverage.slaVendidas - coverage.billableHours);
    if (coverage.slaVendidas > 0 && hoursGap > 8) {
        issues.push({
            severity: 'warning',
            code: 'HOURS_UNDER_SLA',
            message: `Faltan ~${hoursGap}h facturables vs SLA vendidas`,
        });
    }
    else if (coverage.slaVendidas > 0 && hoursGap < -8) {
        issues.push({
            severity: 'warning',
            code: 'HOURS_OVER_SLA',
            message: `Exceso ~${Math.abs(hoursGap)}h sobre SLA vendidas`,
        });
    }
    const blocking = issues.filter((i) => i.severity === 'blocking');
    return {
        ok: blocking.length === 0 && coverage.coverageRatio >= 0.98,
        issues,
        billableHours: Math.round(coverage.billableHours),
        slaVendidas: coverage.slaVendidas,
        hoursGap,
    };
}
//# sourceMappingURL=phase7-verify.js.map