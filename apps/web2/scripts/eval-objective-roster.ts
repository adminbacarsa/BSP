/**
 * Smoke — fase 0 dotación: en objetivos mixtos (24hs + custom) se cierra
 * el cupo 24hs antes de asignar MA/ME.
 * Ejecutar: npm run eval:objective-roster
 */
import type { V2EmployeeDef, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import {
    objectiveHasMixedScheduleKinds,
    resolveObjectivePositionRoster,
} from '../src/lib/planificacion/objectiveRosterResolver';

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const puesto24: V2PositionDef = {
    positionName: 'Puesto 1',
    qty: 1,
    coverageType: '24hs',
    shifts: [
        { code: 'M', name: 'Mañana', hours: 8 },
        { code: 'T', name: 'Tarde', hours: 8 },
        { code: 'N', name: 'Noche', hours: 8 },
    ],
};

const museoLv: V2PositionDef = {
    positionName: 'Museo',
    qty: 4,
    coverageType: 'custom',
    shifts: [{ code: 'MA', name: 'mañana', hours: 9, days: ['L', 'M', 'X', 'J', 'V'] }],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};

const directorioLv: V2PositionDef = {
    positionName: 'DIRECTORIO',
    qty: 2,
    coverageType: 'custom',
    shifts: [{ code: 'ME', name: 'm ex', hours: 12, days: ['L', 'M', 'X', 'J', 'V'] }],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};

const mixedPositions = [puesto24, museoLv, directorioLv];

assert(objectiveHasMixedScheduleKinds(mixedPositions), 'Casa Matriz es objetivo mixto');

const sortedEmps: V2EmployeeDef[] = Array.from({ length: 10 }, (_, i) => ({
    id: `g${i + 1}`,
}));

const positionNeed = {
    'Puesto 1': 4,
    Museo: 4,
    DIRECTORIO: 2,
};

const empMeta = Object.fromEntries(sortedEmps.map((e) => [e.id, { priorityScore: 0 }]));

const mixed = resolveObjectivePositionRoster({
    positions: mixedPositions,
    sortedEmps,
    positionNeed,
    defaultPos: {},
    userLockedPos: {},
    empMeta,
    perPositionMonthHours: { 'Puesto 1': 744, Museo: 180, DIRECTORIO: 120 },
    hardMax: 200,
    overcapFactor: 1.05,
});

assert(mixed.phasedByKind, 'phasedByKind activo en mixto');
assert(mixed.positionGroups['Puesto 1'].length === 4, '24hs recibe 4 guardias');
assert(
    mixed.positionGroups['Puesto 1'].every((id) => ['g1', 'g2', 'g3', 'g4'].includes(id)),
    'los 4 primeros del orden van a 24hs',
);
assert(mixed.positionGroups.Museo.length === 4, 'Museo recibe 4 tras cerrar 24hs');
assert(mixed.positionGroups.DIRECTORIO.length === 2, 'DIRECTORIO recibe 2');
assert(mixed.virtualAssignmentCount === 10, 'toda la dotación es virtual');

const fixedMuseo = resolveObjectivePositionRoster({
    positions: mixedPositions,
    sortedEmps,
    positionNeed,
    defaultPos: { g1: 'Museo' },
    userLockedPos: { g1: 'Museo' },
    empMeta,
    perPositionMonthHours: { 'Puesto 1': 744, Museo: 180, DIRECTORIO: 120 },
    hardMax: 200,
    overcapFactor: 1.05,
});

assert(fixedMuseo.positionGroups.Museo.includes('g1'), 'legajo fijo en Museo se respeta');
assert(
    fixedMuseo.positionGroups['Puesto 1'].length === 4,
    '24hs sigue cerrando cupo con el resto',
);
assert(
    !fixedMuseo.positionGroups['Puesto 1'].includes('g1'),
    'g1 fijo en Museo no ocupa slot 24hs',
);

const only24 = resolveObjectivePositionRoster({
    positions: [puesto24],
    sortedEmps: sortedEmps.slice(0, 4),
    positionNeed: { 'Puesto 1': 4 },
    defaultPos: {},
    userLockedPos: {},
    empMeta,
    perPositionMonthHours: { 'Puesto 1': 744 },
    hardMax: 200,
    overcapFactor: 1.05,
    phasedByKind: false,
});

assert(!only24.phasedByKind, 'solo 24hs no fuerza phased');
assert(only24.positionGroups['Puesto 1'].length === 4, 'solo 24hs asigna 4');

// Obrador: rosterSeed custom-first NO debe bloquear phased 24hs→custom
const obradorCustomFirst: V2PositionDef[] = [
    {
        positionName: 'Puesto Encargada',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'EN', name: 'Encargada', hours: 9, days: ['L', 'M', 'X', 'J', 'V'] }],
    },
    {
        positionName: 'Puesto 3',
        qty: 1,
        coverageType: '24hs',
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8 },
            { code: 'T', name: 'Tarde', hours: 8 },
            { code: 'N', name: 'Noche', hours: 8 },
        ],
    },
];
const obradorNeed = { 'Puesto Encargada': 2, 'Puesto 3': 4 };
const obradorEmps = Array.from({ length: 6 }, (_, i) => ({ id: `o${i + 1}` }));
const obradorMeta = Object.fromEntries(obradorEmps.map((e) => [e.id, { priorityScore: 0 }]));
const obradorSeed = { o1: 'Puesto Encargada', o2: 'Puesto Encargada' };
const obradorRoster = resolveObjectivePositionRoster({
    positions: obradorCustomFirst,
    sortedEmps: obradorEmps,
    positionNeed: obradorNeed,
    defaultPos: obradorSeed,
    userLockedPos: {},
    empMeta: obradorMeta,
    perPositionMonthHours: { 'Puesto Encargada': 180, 'Puesto 3': 744 },
    hardMax: 200,
    overcapFactor: 1.05,
});
assert(
    obradorRoster.positionGroups['Puesto 3'].length === 4,
    'rosterSeed custom-first no bloquea cupo 24hs (4 guardias)',
);
assert(
    obradorRoster.positionGroups['Puesto 3'].includes('o1'),
    'o1 con seed Encargada va a 24hs en phased (no bloqueado por seed)',
);
assert(
    !obradorRoster.positionGroups['Puesto Encargada'].includes('o1'),
    'o1 con solo rosterSeed no queda titular custom',
);

console.log('eval-objective-roster: OK');
