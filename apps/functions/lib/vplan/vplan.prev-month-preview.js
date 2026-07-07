"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPrevMonthTrailingPreview = buildPrevMonthTrailingPreview;
const vplan_calendar_1 = require("./vplan.calendar");
function buildPrevMonthTrailingPreview(targetYear, targetMonth, snapshot) {
    const prev = (0, vplan_calendar_1.previousMonth)(targetYear, targetMonth);
    const prevDays = (0, vplan_calendar_1.buildMonthDays)(prev.year, prev.month);
    const tailDates = prevDays.slice(-7).map((d) => d.dateStr);
    const byEmpDate = new Map();
    for (const a of snapshot.previousMonthAssignments) {
        byEmpDate.set(`${a.employeeId}_${a.dateStr}`, String(a.code || '').toUpperCase());
    }
    const prevState = snapshot.prevPlanningState;
    const rows = snapshot.employees.map((emp) => {
        const tailDays = tailDates.map((dateStr) => ({
            dateStr,
            code: byEmpDate.get(`${emp.id}_${dateStr}`) ?? '',
        }));
        const empDates = snapshot.previousMonthAssignments
            .filter((a) => a.employeeId === emp.id)
            .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        const lastRow = empDates.length > 0 ? empDates[empDates.length - 1] : undefined;
        return {
            employeeId: emp.id,
            displayName: emp.displayName,
            lastDate: lastRow?.dateStr,
            lastCode: lastRow?.code?.toUpperCase() ?? prevState.lastShiftByEmp?.[emp.id],
            trailingWork: prevState.trailingWorkDays?.[emp.id],
            trailingRest: prevState.trailingRestDays?.[emp.id],
            tailDays,
        };
    }).filter((r) => r.lastDate
        || r.lastCode
        || r.tailDays.some((d) => d.code));
    return {
        prevYear: prev.year,
        prevMonth: prev.month,
        prevMonthKey: snapshot.previousMonthStateKey,
        assignmentCount: snapshot.previousMonthAssignments.length,
        employeesWithTrailing: Object.keys(prevState.lastShiftByEmp || {}).length,
        tailDateStrs: tailDates,
        rows,
    };
}
//# sourceMappingURL=vplan.prev-month-preview.js.map