import {
    fetchPlanningMonthAbsences,
    fetchPlanningMonthShifts,
} from './loadPlanningMonthShifts';
import {
    calendarMonthsBefore,
    DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
    extractPlanningCoverageWisdom,
    mergeCoverageWisdom,
    type PlanningCoverageWisdom,
    type PlanningShiftCell,
} from './planningCoverageWisdom';
import { saveWisdomEntry } from './planningWisdomStorage';

export { calendarMonthsBefore, DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS };

export async function fetchCoverageWisdomHistory(params: {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    lookbackMonths?: number;
    scopeEmpresa?: boolean;
    migracionCompleta?: boolean;
    employeeNames?: Record<string, string>;
    rosterEmployeeIds?: Set<string>;
    persistCache?: boolean;
}): Promise<PlanningCoverageWisdom> {
    const {
        empresaId,
        objectiveId,
        year,
        month,
        lookbackMonths = DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
        scopeEmpresa = true,
        migracionCompleta = true,
        employeeNames = {},
        rosterEmployeeIds,
        persistCache = true,
    } = params;

    const months = calendarMonthsBefore(year, month, lookbackMonths);
    const roster = rosterEmployeeIds ?? new Set(Object.keys(employeeNames));
    const monthlyWisdom: PlanningCoverageWisdom[] = [];
    const allCells: PlanningShiftCell[] = [];

    for (const { year: y, month: m } of months) {
        const cells = await fetchPlanningMonthShifts({
            empresaId,
            objectiveId,
            year: y,
            month: m,
            scopeEmpresa,
            migracionCompleta,
            employeeNames,
        });
        allCells.push(...cells);
        const absences = await fetchPlanningMonthAbsences({
            empresaId,
            year: y,
            month: m,
            rosterEmployeeIds: roster,
            scopeEmpresa,
            migracionCompleta,
        });
        monthlyWisdom.push(
            extractPlanningCoverageWisdom(cells, {
                objectiveId,
                year: y,
                month: m,
                absences,
            }),
        );
    }

    const merged = mergeCoverageWisdom(monthlyWisdom, {
        objectiveId,
        targetYear: year,
        targetMonth: month,
        lookbackMonths,
        allCells,
    });

    if (persistCache) {
        saveWisdomEntry(merged);
    }

    return merged;
}
