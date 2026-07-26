/**
 * Smoke: sabiduría histórica de coberturas (merge + perfiles de trabajo).
 * npm run eval:coverage-wisdom
 */
import {
    calendarMonthsBefore,
    DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS,
    extractEmployeeWorkProfiles,
    extractPlanningCoverageWisdom,
    mergeCoverageWisdom,
    positionAffinityScore,
    shift12hAffinityScore,
    type PlanningShiftCell,
} from '../src/lib/planificacion/planningCoverageWisdom';

const OBJ = 'obj-test';

function cell(
    empId: string,
    dateStr: string,
    code: string,
    positionName: string,
    extra?: Partial<PlanningShiftCell>,
): PlanningShiftCell {
    return {
        id: `${empId}_${dateStr}`,
        employeeId: empId,
        employeeName: empId,
        objectiveId: OBJ,
        dateStr,
        code,
        positionName,
        ...extra,
    };
}

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

const months = calendarMonthsBefore(2026, 7, DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS);
assert(months.length === 6, 'lookback 6 meses');
assert(months[0].year === 2026 && months[0].month === 1, 'primer mes ene 2026');

const cellsApr: PlanningShiftCell[] = [
    cell('g1', '2026-04-10', 'V', 'Puesto 1'),
    cell('g2', '2026-04-10', 'M', 'Puesto 1', { coversEmployeeId: 'g1' }),
    cell('g3', '2026-04-11', 'D12', 'Museo'),
    cell('g3', '2026-04-12', 'D12', 'Museo'),
];

const cellsMay: PlanningShiftCell[] = [
    cell('g2', '2026-05-05', 'L', 'Puesto 1'),
    cell('g3', '2026-05-05', 'T', 'Puesto 1', { coveredByEmployeeId: 'g3' }),
];

const wApr = extractPlanningCoverageWisdom(cellsApr, { objectiveId: OBJ, year: 2026, month: 4 });
const wMay = extractPlanningCoverageWisdom(cellsMay, { objectiveId: OBJ, year: 2026, month: 5 });
const merged = mergeCoverageWisdom([wApr, wMay], {
    objectiveId: OBJ,
    targetYear: 2026,
    targetMonth: 7,
    lookbackMonths: 3,
    allCells: [...cellsApr, ...cellsMay],
});

assert(merged.events.length >= 1, 'debe detectar coberturas');
assert(merged.monthsIncluded?.length === 2, 'meses incluidos');

const profiles = extractEmployeeWorkProfiles([...cellsApr, ...cellsMay], OBJ);
assert((profiles.g3?.shift12hCount ?? 0) === 2, 'g3 hace 12h');
assert(positionAffinityScore('g3', 'Museo', merged) > positionAffinityScore('g2', 'Museo', merged), 'afinidad puesto Museo');
assert(shift12hAffinityScore('g3', merged) > shift12hAffinityScore('g2', merged), 'afinidad 12h g3');

console.log('eval:coverage-wisdom OK');
console.log(merged.summary);
