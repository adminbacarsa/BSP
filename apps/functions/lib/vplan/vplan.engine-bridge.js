"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toEnginePositions = toEnginePositions;
exports.buildCodeHoursHint = buildCodeHoursHint;
exports.buildEngineContext = buildEngineContext;
exports.engineToVplanAssignments = engineToVplanAssignments;
function toEnginePositions(positions) {
    return positions.map((p) => ({
        positionName: p.positionName,
        qty: p.qty,
        shifts: p.shifts.map((s) => ({
            code: s.code,
            hours: s.hours,
            startTime: s.startTime,
            endTime: s.endTime,
        })),
        activeDays: p.activeDays,
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
    const useTrailing = opts.strategy.modes.useTrailing;
    return {
        positions: toEnginePositions(opts.snapshot.positions),
        employees,
        daysInMonth,
        slaVendidas: opts.snapshot.slaVendidas,
        autoCycles: [opts.strategy.cycle],
        absences: opts.snapshot.absences,
        defaultPositionByEmp: { ...opts.planningState.defaultPositionByEmp },
        defaultShiftByEmp: { ...opts.planningState.defaultShiftByEmp },
        prevMonthTrailingWorkDays: useTrailing ? opts.prevPlanningState.trailingWorkDays : undefined,
        prevMonthTrailingRestDays: useTrailing ? opts.prevPlanningState.trailingRestDays : undefined,
        prevMonthLastShiftByEmp: useTrailing ? opts.prevPlanningState.lastShiftByEmp : undefined,
        prevMonthLastWorkBandBeforeRest: useTrailing ? opts.prevPlanningState.lastWorkBandBeforeRest : undefined,
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