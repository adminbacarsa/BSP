"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toEnginePositions = toEnginePositions;
exports.buildCodeHoursHint = buildCodeHoursHint;
exports.buildEngineContext = buildEngineContext;
exports.engineToVplanAssignments = engineToVplanAssignments;
const vplan_sla_enforce_1 = require("./vplan.sla-enforce");
const vplan_positions_1 = require("./vplan.positions");
function toEnginePositions(positions, cycle) {
    const filtered = cycle ? (0, vplan_positions_1.positionsForCycle)(positions, cycle) : positions;
    return filtered.map((p) => ({
        positionName: p.positionName,
        qty: p.qty,
        shifts: p.shifts.map((s) => ({
            code: s.code,
            hours: s.hours,
            startTime: s.startTime,
            endTime: s.endTime,
            days: s.days,
        })),
        activeDays: (0, vplan_positions_1.resolveActiveDays)(p),
        coverageType: p.coverageType,
    }));
}
function buildCodeHoursHint(positions) {
    const hint = {};
    for (const p of positions) {
        for (const s of p.shifts) {
            if (s.code && s.hours > 0)
                hint[s.code] = s.hours;
        }
    }
    return hint;
}
function buildEngineContext(opts) {
    const daysInMonth = opts.snapshot.days.map((d) => {
        const [y, m, day] = d.dateStr.split('-').map(Number);
        return new Date(y, m - 1, day, 12, 0, 0);
    });
    const employees = opts.snapshot.employees.map((e) => ({
        id: e.id,
        nombre: e.displayName,
    }));
    const defaultPositionByEmp = (0, vplan_sla_enforce_1.capDefaultPositionByEmp)(opts.snapshot.positions, {
        ...opts.prevPlanningState.defaultPositionByEmp,
        ...opts.planningState.defaultPositionByEmp,
    }, opts.strategy.cycle);
    const defaultShiftByEmp = {
        ...opts.prevPlanningState.defaultShiftByEmp,
        ...opts.planningState.defaultShiftByEmp,
    };
    return {
        positions: toEnginePositions(opts.snapshot.positions, opts.strategy.cycle),
        employees,
        daysInMonth,
        slaVendidas: opts.snapshot.slaVendidas,
        autoCycles: [opts.strategy.cycle],
        absences: opts.snapshot.absences,
        defaultPositionByEmp,
        defaultShiftByEmp,
        prevMonthTrailingWorkDays: opts.strategy.modes.useTrailing
            ? opts.prevPlanningState.trailingWorkDays
            : undefined,
        prevMonthTrailingRestDays: opts.strategy.modes.useTrailing
            ? opts.prevPlanningState.trailingRestDays
            : undefined,
        prevMonthLastShiftByEmp: opts.strategy.modes.useTrailing
            ? opts.prevPlanningState.lastShiftByEmp
            : undefined,
        prevMonthLastWorkBandBeforeRest: opts.strategy.modes.useTrailing
            ? opts.prevPlanningState.lastWorkBandBeforeRest
            : undefined,
        cctCutoffDay: opts.cctCutoffDay ?? 25,
        codeHoursHint: buildCodeHoursHint(opts.snapshot.positions),
    };
}
function engineToVplanAssignments(assignments) {
    return assignments.map((a) => ({
        employeeId: a.empId,
        dateStr: a.dateStr,
        code: a.code,
        positionName: a.positionName,
        hours: a.hours,
    }));
}
//# sourceMappingURL=vplan.engine-bridge.js.map