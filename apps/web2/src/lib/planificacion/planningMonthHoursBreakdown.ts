import {
  calcPlanningBillableShiftHours,
  calcPlanningSlaReconciliationHours,
} from '@/lib/planificacion/planningScheduledHours';

export type EmployeeMonthHoursRow = {
  empId: string;
  name: string;
  gross: number;
  baseSla: number;
  coverageExtra: number;
  excludedBillable: number;
  legajoColumnGross: number;
};

export type PlanningMonthHoursBreakdown = {
  gross: number;
  baseSla: number;
  coverageExtra: number;
  excludedBillable: number;
  byEmployee: EmployeeMonthHoursRow[];
  byCodeGross: Record<string, number>;
};

export function computePlanningMonthHoursBreakdown(params: {
  displayedEmployees: Array<{ id: string; name?: string }>;
  daysInMonth: Date[];
  getDateKey: (day: Date) => string;
  resolveActiveShift: (empId: string, dateStr: string) => any | null;
  isExcludedFromBillable: (shift: any, dateStr: string, shiftPos: string) => boolean;
  countsForEmployeeHours: (shift: any) => boolean;
  slaCodeHoursHint?: Record<string, number>;
}): PlanningMonthHoursBreakdown {
  const {
    displayedEmployees,
    daysInMonth,
    getDateKey,
    resolveActiveShift,
    isExcludedFromBillable,
    countsForEmployeeHours,
    slaCodeHoursHint,
  } = params;

  const byEmployeeMap = new Map<string, EmployeeMonthHoursRow>();
  const byCodeGross: Record<string, number> = {};
  let gross = 0;
  let baseSla = 0;
  let coverageExtra = 0;
  let excludedBillable = 0;

  const ensureEmp = (emp: { id: string; name?: string }) => {
    let row = byEmployeeMap.get(emp.id);
    if (!row) {
      row = {
        empId: emp.id,
        name: String(emp.name || emp.id).trim(),
        gross: 0,
        baseSla: 0,
        coverageExtra: 0,
        excludedBillable: 0,
        legajoColumnGross: 0,
      };
      byEmployeeMap.set(emp.id, row);
    }
    return row;
  };

  displayedEmployees.forEach((emp) => {
    daysInMonth.forEach((day) => {
      const dateStr = getDateKey(day);
      const activeShift = resolveActiveShift(emp.id, dateStr);
      if (!activeShift) return;
      if (!countsForEmployeeHours(activeShift)) return;

      const shiftPos = String(activeShift.positionName || (emp as { assignedPosition?: string }).assignedPosition || '').trim();
      const code = String(activeShift.code || activeShift.type || '').trim().toUpperCase() || '—';
      const billable = calcPlanningBillableShiftHours(activeShift, slaCodeHoursHint);
      if (billable <= 0) return;

      const row = ensureEmp(emp);

      if (isExcludedFromBillable(activeShift, dateStr, shiftPos)) {
        excludedBillable += billable;
        row.excludedBillable += billable;
        return;
      }

      const base = calcPlanningSlaReconciliationHours(activeShift, slaCodeHoursHint);
      const extra = Math.max(0, Math.round((billable - base) * 100) / 100);

      gross += billable;
      baseSla += base;
      coverageExtra += extra;
      row.gross += billable;
      row.baseSla += base;
      row.coverageExtra += extra;
      row.legajoColumnGross += billable;
      byCodeGross[code] = (byCodeGross[code] || 0) + billable;
    });
  });

  const round = (n: number) => Math.round(n * 10) / 10;

  const byEmployee = [...byEmployeeMap.values()]
    .map((r) => ({
      ...r,
      gross: round(r.gross),
      baseSla: round(r.baseSla),
      coverageExtra: round(r.coverageExtra),
      excludedBillable: round(r.excludedBillable),
      legajoColumnGross: round(r.legajoColumnGross),
    }))
    .filter((r) => r.gross > 0 || r.excludedBillable > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return {
    gross: round(gross),
    baseSla: round(baseSla),
    coverageExtra: round(coverageExtra),
    excludedBillable: round(excludedBillable),
    byEmployee,
    byCodeGross,
  };
}
