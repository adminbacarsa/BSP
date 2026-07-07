/**
 * Vista previa del mes anterior — rachas y cola de turnos para VPLAN Lab.
 */

import { buildMonthDays, previousMonth } from './vplan.calendar';
import type { VplanPlanningSnapshot } from './vplan.firestore';
import type { VplanPrevMonthPreview } from './vplan.types';

export function buildPrevMonthTrailingPreview(
  targetYear: number,
  targetMonth: number,
  snapshot: VplanPlanningSnapshot,
): VplanPrevMonthPreview {
  const prev = previousMonth(targetYear, targetMonth);
  const prevDays = buildMonthDays(prev.year, prev.month);
  const tailDates = prevDays.slice(-7).map((d) => d.dateStr);

  const byEmpDate = new Map<string, string>();
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
    const lastRow = empDates.length > 0 ? empDates[empDates.length - 1]! : undefined;

    return {
      employeeId: emp.id,
      displayName: emp.displayName,
      lastDate: lastRow?.dateStr,
      lastCode: lastRow?.code?.toUpperCase() ?? prevState.lastShiftByEmp?.[emp.id],
      trailingWork: prevState.trailingWorkDays?.[emp.id],
      trailingRest: prevState.trailingRestDays?.[emp.id],
      tailDays,
    };
  }).filter((r) =>
    r.lastDate
    || r.lastCode
    || r.tailDays.some((d) => d.code),
  );

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
