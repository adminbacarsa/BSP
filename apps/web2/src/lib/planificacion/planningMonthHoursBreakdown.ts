import { coalescePlannedTurnosForCell } from '@/lib/planificacion/planningTurnoCoalesce';
import {
  billableHoursForPlanningCell,
  slaBaseHoursForPlanningCell,
} from '@/lib/planificacion/planningEmployeeCellHours';
import type { PlanningCellHoursContext } from '@/lib/planificacion/planningEmployeeCellHours';
import { shiftCountsForEmployeeCronoHours } from '@/lib/planificacion/deploymentRoles';

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
  displayedEmployees: Array<{ id: string; name?: string; assignedPosition?: string }>;
  daysInMonth: Date[];
  getDateKey: (day: Date) => string;
  resolveCellTurnos: (empId: string, dateStr: string) => any[];
  cellHoursCtxForEmp: (emp: { id: string; assignedPosition?: string }) => PlanningCellHoursContext;
}): PlanningMonthHoursBreakdown {
  const {
    displayedEmployees,
    daysInMonth,
    getDateKey,
    resolveCellTurnos,
    cellHoursCtxForEmp,
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
    const ctx = cellHoursCtxForEmp(emp);
    daysInMonth.forEach((day) => {
      const dateStr = getDateKey(day);
      const turnos = resolveCellTurnos(emp.id, dateStr);
      if (!turnos.length) return;

      const billable = billableHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
      const row = ensureEmp(emp);

      if (billable <= 0) {
        const excludedOnly = turnos.filter((t) => {
          if (!shiftCountsForEmployeeCronoHours(t)) return false;
          const shiftPos = String(t.positionName || emp.assignedPosition || '').trim();
          return ctx.isExcludedFromBillable(t, dateStr, shiftPos);
        });
        if (excludedOnly.length) {
          const exH = billableHoursForPlanningCell(
            excludedOnly,
            dateStr,
            emp.id,
            { ...ctx, isExcludedFromBillable: () => false },
          );
          if (exH > 0) {
            excludedBillable += exH;
            row.excludedBillable += exH;
          }
        }
        return;
      }

      const base = slaBaseHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
      const extra = Math.max(0, Math.round((billable - base) * 100) / 100);
      const merged = coalescePlannedTurnosForCell(
        turnos.filter((t) => shiftCountsForEmployeeCronoHours(t)),
        ctx.slaCodeHoursHint,
      );
      const code = String(merged?.code || merged?.type || '').trim().toUpperCase() || '—';

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
