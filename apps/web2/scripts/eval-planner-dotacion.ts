/**
 * Smoke: validación dotación planificador vs SLA + alineación sabiduría.
 * Ejecutar: npm run eval:planner-dotacion
 */
import type { V2EmployeeDef, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import {
    validatePlannerDotacionAgainstSla,
    hasExplicitPlannerDotacion,
} from '../src/lib/planificacion/plannerDotacionValidator';
import {
    alignPositionGroupsWithWisdom,
} from '../src/lib/planificacion/wisdomRosterAlignment';
import type { PlanningCoverageWisdom } from '../src/lib/planificacion/planningCoverageWisdom';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
    console.log(`OK: ${msg}`);
}

const positions: V2PositionDef[] = [
    {
        positionName: 'Puesto Playa',
        qty: 1,
        coverageType: '24hs',
        shifts: [{ code: 'M', hours: 8 }],
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
    {
        positionName: 'Puesto Hall',
        qty: 1,
        coverageType: '24hs',
        shifts: [{ code: 'T', hours: 8 }],
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
];

const employees: V2EmployeeDef[] = [
    { id: 'a', nombre: 'A' },
    { id: 'b', nombre: 'B' },
    { id: 'c', nombre: 'C' },
    { id: 'd', nombre: 'D' },
    { id: 'e', nombre: 'E' },
    { id: 'f', nombre: 'F' },
];

// 6 en Playa, 0 en Hall → error planificador (necesita 4+4)
const badDotacion: Record<string, string> = {
    a: 'Puesto Playa',
    b: 'Puesto Playa',
    c: 'Puesto Playa',
    d: 'Puesto Playa',
    e: 'Puesto Playa',
    f: 'Puesto Playa',
};

const badReport = validatePlannerDotacionAgainstSla({
    positions,
    employees,
    defaultPositionByEmp: badDotacion,
    cycleKey: '6+2',
});
assert(hasExplicitPlannerDotacion(badDotacion), 'dotación explícita detectada');
assert(!badReport.ok, '6 en Playa es error vs SLA 4');
assert(badReport.errors.some((e) => e.includes('Puesto Playa')), 'error menciona Playa');
assert(badReport.byPosition.find((r) => r.positionName === 'Puesto Playa')?.status === 'over', 'Playa over');

// 4+4 OK
const goodDotacion: Record<string, string> = {
    a: 'Puesto Playa',
    b: 'Puesto Playa',
    c: 'Puesto Playa',
    d: 'Puesto Playa',
    e: 'Puesto Hall',
    f: 'Puesto Hall',
};
// need 4 per position - only 2 in hall → under
const partialReport = validatePlannerDotacionAgainstSla({
    positions,
    employees: employees.slice(0, 6),
    defaultPositionByEmp: goodDotacion,
    cycleKey: '6+2',
});
assert(!partialReport.ok, 'Hall con 2/4 es error');
assert(partialReport.byPosition.find((r) => r.positionName === 'Puesto Hall')?.status === 'under', 'Hall under');

const wisdom: PlanningCoverageWisdom = {
    objectiveId: 'obj',
    periodLabel: 'test',
    daysAnalyzed: 30,
    cellsAnalyzed: 100,
    absenceContextsFound: 0,
    events: [],
    coverers: [],
    strategyCounts: {},
    summary: 'test',
    extractedAt: new Date().toISOString(),
    employeeProfiles: {
        a: {
            empId: 'a',
            nombre: 'A',
            totalWorkDays: 20,
            byPosition: { 'Puesto Hall': 18, 'Puesto Playa': 2 },
            byBand: { M: 20 },
            shift12hCount: 0,
            shift8hCount: 20,
            maxWorkStreak: 6,
            retDays: 0,
        },
        b: {
            empId: 'b',
            nombre: 'B',
            totalWorkDays: 20,
            byPosition: { 'Puesto Playa': 19, 'Puesto Hall': 1 },
            byBand: { M: 20 },
            shift12hCount: 0,
            shift8hCount: 20,
            maxWorkStreak: 6,
            retDays: 0,
        },
        c: { empId: 'c', nombre: 'C', totalWorkDays: 10, byPosition: { 'Puesto Playa': 10 }, byBand: {}, shift12hCount: 0, shift8hCount: 10, maxWorkStreak: 4, retDays: 0 },
        d: { empId: 'd', nombre: 'D', totalWorkDays: 10, byPosition: { 'Puesto Playa': 10 }, byBand: {}, shift12hCount: 0, shift8hCount: 10, maxWorkStreak: 4, retDays: 0 },
        e: { empId: 'e', nombre: 'E', totalWorkDays: 10, byPosition: { 'Puesto Hall': 10 }, byBand: {}, shift12hCount: 0, shift8hCount: 10, maxWorkStreak: 4, retDays: 0 },
        f: { empId: 'f', nombre: 'F', totalWorkDays: 10, byPosition: { 'Puesto Hall': 10 }, byBand: {}, shift12hCount: 0, shift8hCount: 10, maxWorkStreak: 4, retDays: 0 },
    },
};

const positionGroups: Record<string, string[]> = {
    'Puesto Playa': ['a', 'c'],
    'Puesto Hall': ['b', 'd'],
};
const empAssignedTo: Record<string, string | null> = {
    a: 'Puesto Playa',
    b: 'Puesto Hall',
    c: 'Puesto Playa',
    d: 'Puesto Hall',
};

const aligned = alignPositionGroupsWithWisdom({
    positionGroups,
    empAssignedTo,
    positionNames: ['Puesto Playa', 'Puesto Hall'],
    wisdom,
    apply: true,
    minScoreGain: 5,
});
assert(aligned.appliedSwaps.length >= 1, 'sabiduría intercambia por afinidad cruzada');
assert(
    (empAssignedTo['a'] === 'Puesto Hall' && empAssignedTo['b'] === 'Puesto Playa')
    || aligned.appliedSwaps.length > 0,
    'swap aplicado en roster',
);

console.log('\n=== eval:planner-dotacion PASS ===');
