/**
 * Smoke: multipax 24hs + objetivo mixto (Obrador Malagueño).
 * Ejecutar: npm run eval:multipax-24hs
 */
import { buildObjectiveCoverageDemand } from '../src/lib/planificacion/objectiveCoverageDemand';
import {
    iterMultipax24hsPools,
    pax24hsQty,
    rebalance24hsPositionGroupsByNeed,
    trim24hsPositionGroupsToNeed,
} from '../src/lib/planificacion/multipax24hsRotation';
import type { V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import { computePositionRequiredHeadcount } from '../src/lib/planificacion/objectiveHeadcount';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
    console.log(`OK: ${msg}`);
}

const positions: V2PositionDef[] = [
    {
        positionName: 'Puesto Encargada',
        qty: 1,
        coverageType: 'custom',
        shifts: [{ code: 'EN', name: 'Encargada', hours: 9 }],
        activeDays: ['L', 'M', 'X', 'J', 'V'],
    },
    {
        positionName: 'Puesto Rondin',
        qty: 1,
        coverageType: 'custom',
        shifts: [{ code: 'RO', name: 'Rondin', hours: 10 }],
        activeDays: ['L', 'M', 'X', 'J', 'V'],
    },
    {
        positionName: 'Puesto 3',
        qty: 1,
        coverageType: '24hs',
        shifts: [
            { code: 'M', hours: 8 },
            { code: 'T', hours: 8 },
            { code: 'N', hours: 8 },
        ],
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
    {
        positionName: 'Puesto 1',
        qty: 2,
        coverageType: '24hs',
        shifts: [
            { code: 'M', hours: 8 },
            { code: 'T', hours: 8 },
            { code: 'N', hours: 8 },
        ],
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
    {
        positionName: 'Puesto 2',
        qty: 1,
        coverageType: '24hs',
        shifts: [
            { code: 'M', hours: 8 },
            { code: 'T', hours: 8 },
            { code: 'N', hours: 8 },
        ],
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
];

const positionNeed: Record<string, number> = {};
for (const p of positions) {
    positionNeed[p.positionName] = computePositionRequiredHeadcount(p, '6+2');
}

assert(positionNeed['Puesto 1'] === 8, 'Puesto 1 qty=2 → 8 guardias');
assert(positionNeed['Puesto 2'] === 4, 'Puesto 2 qty=1 → 4 guardias');
assert(positionNeed['Puesto 3'] === 4, 'Puesto 3 qty=1 → 4 guardias');

const p1Pool = Array.from({ length: 8 }, (_, i) => `p1-${i}`);
const pools = iterMultipax24hsPools(positions[3], p1Pool, '6+2');
assert(pools.length === 2, 'Puesto 1 → 2 pools de rotación');
assert(pools[0].length === 4 && pools[1].length === 4, 'Cada pool 4 guardias');

const days = [{ dateStr: '2026-07-01', dayLetter: 'M' }];
const demand = buildObjectiveCoverageDemand(
    positions,
    days,
    ['6+2'],
    (pos, letter) => (pos.activeDays as string[]).includes(letter),
);
const p1Demand = demand[0].positions.find((p) => p.positionName === 'Puesto 1');
assert(p1Demand?.qty === 2, 'Demanda Puesto 1 pax=2');
assert(p1Demand?.bandSlots.M === 2, 'Demanda Puesto 1 → 2 en M');
assert(p1Demand?.bandSlots.T === 2, 'Demanda Puesto 1 → 2 en T');
assert(p1Demand?.bandSlots.N === 2, 'Demanda Puesto 1 → 2 en N');

const positionGroups: Record<string, string[]> = {
    'Puesto 3': ['a', 'b', 'c', 'd', 'e'],
    'Puesto 2': ['f', 'g', 'h', 'i'],
    'Puesto 1': p1Pool,
};
const empAssignedTo: Record<string, string | null> = {};
for (const [pos, ids] of Object.entries(positionGroups)) {
    ids.forEach((id) => { empAssignedTo[id] = pos; });
}

rebalance24hsPositionGroupsByNeed(
    positions,
    positionGroups,
    empAssignedTo,
    positionNeed,
    '6+2',
);
trim24hsPositionGroupsToNeed(positions, positionGroups, empAssignedTo, positionNeed, '6+2');

assert(positionGroups['Puesto 3'].length === 4, 'Rebalance recorta Puesto 3 a 4 (no 5)');
assert(positionGroups['Puesto 2'].length === 4, 'Puesto 2 mantiene 4');
assert(positionGroups['Puesto 1'].length === 8, 'Puesto multipax intacto');
assert(pax24hsQty(positions[3]) === 2, 'pax24hsQty Puesto 1');

console.log('---');
console.log('Multipax 24hs OK.');
