/**
 * Smoke: comparación julio vs agosto (Shopping-like) y nomenclatura S1/S2/S3.
 */
import type { V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import type { PlanningShiftCell } from '../src/lib/planificacion/planningCoverageWisdom';
import {
    compareObjectiveMonthSchedules,
    formatCompareObjectiveMonthsReport,
    summarizeMonthScheduleCoverage,
} from '../src/lib/planificacion/compareObjectiveMonthSchedules';

const ALL = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

function pos(
    name: string,
    code: string,
    qty = 1,
): V2PositionDef {
    return {
        positionName: name,
        qty,
        coverageType: 'custom',
        shifts: [{ code, hours: 8, days: [...ALL] }],
        activeDays: [...ALL],
    };
}

const SHOPPING_POSITIONS: V2PositionDef[] = [
    {
        positionName: 'CONTROL',
        qty: 1,
        coverageType: 'custom',
        shifts: [
            { code: 'M', hours: 8, days: [...ALL] },
            { code: 'T', hours: 8, days: [...ALL] },
            { code: 'N', hours: 8, days: [...ALL] },
        ],
        activeDays: [...ALL],
    },
    pos('SH', 'SH'),
    pos('SALON 1', 'S1'),
    pos('SALON 2', 'S2'),
    pos('SALON 3', 'S3'),
    pos('PLAYA', 'P'),
    pos('CORTADO', 'CO'),
    {
        positionName: 'RECEPCION',
        qty: 1,
        coverageType: 'custom',
        shifts: [
            { code: 'RE', hours: 8, days: [...ALL] },
            { code: 'DO', hours: 8, days: [...ALL] },
        ],
        activeDays: [...ALL],
    },
];

const OID = 'shopping-vm';
const year = 2026;
const julyDays: Array<{ dateStr: string; dayLetter: string }> = [];
for (let d = 1; d <= 31; d++) {
    const dateStr = `${year}-07-${String(d).padStart(2, '0')}`;
    const letterMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    const dt = new Date(`${dateStr}T12:00:00`);
    julyDays.push({ dateStr, dayLetter: letterMap[dt.getDay()] });
}

function makeFullDayCells(dateStr: string, empPrefix: string): PlanningShiftCell[] {
    const slots: Array<{ pos: string; code: string }> = [
        { pos: 'CONTROL', code: 'M' },
        { pos: 'CONTROL', code: 'T' },
        { pos: 'CONTROL', code: 'N' },
        { pos: 'SH', code: 'SH' },
        { pos: 'SALON 1', code: 'S1' },
        { pos: 'SALON 2', code: 'S2' },
        { pos: 'SALON 3', code: 'S3' },
        { pos: 'PLAYA', code: 'P' },
        { pos: 'CORTADO', code: 'CO' },
        { pos: 'RECEPCION', code: 'RE' },
        { pos: 'RECEPCION', code: 'DO' },
    ];
    return slots.map((s, i) => ({
        id: `${dateStr}-${i}`,
        employeeId: `${empPrefix}${i}`,
        objectiveId: OID,
        dateStr,
        code: s.code,
        positionName: s.pos,
    }));
}

const julyCells: PlanningShiftCell[] = julyDays.flatMap((day) => makeFullDayCells(day.dateStr, 'jul-'));

const augDays = julyDays.map((d) => ({
    dateStr: d.dateStr.replace('-07-', '-08-'),
    dayLetter: d.dayLetter,
}));

const augBadCells: PlanningShiftCell[] = [];
for (const day of augDays) {
    const partial = makeFullDayCells(day.dateStr, 'aug-').slice(0, 6);
    augBadCells.push(...partial);
    augBadCells.push({
        id: `${day.dateStr}-bad`,
        employeeId: 'aug-bad',
        objectiveId: OID,
        dateStr: day.dateStr,
        code: 'M',
        positionName: 'PLAYA',
    });
}

const julySum = summarizeMonthScheduleCoverage({
    objectiveId: OID,
    positions: SHOPPING_POSITIONS,
    days: julyDays,
    cells: julyCells,
});

if (julySum.daysFull !== 31) {
    console.error('FAIL: julio referencia debe tener 31 días OK, got', julySum.daysFull);
    process.exit(1);
}

const cmp = compareObjectiveMonthSchedules(
    {
        objectiveId: OID,
        positions: SHOPPING_POSITIONS,
        days: julyDays,
        cells: julyCells,
    },
    {
        objectiveId: OID,
        positions: SHOPPING_POSITIONS,
        days: augDays,
        cells: augBadCells,
    },
);

if (cmp.daysWithGapsInCompareOnly.length < 31) {
    console.error('FAIL: agosto simulado debe tener huecos en todos los días');
    process.exit(1);
}

const nomenclature = cmp.compare.nomenclatureViolations.filter((v) => v.positionName === 'PLAYA');
if (nomenclature.length === 0) {
    console.error('FAIL: debe detectar M en PLAYA como nomenclatura inválida');
    process.exit(1);
}

console.log(formatCompareObjectiveMonthsReport(cmp, { reference: 'Julio ref', compare: 'Agosto sim' }));
console.log('\nOK eval-compare-objective-months');
