/**
 * Smoke — rotación custom MA/ME (pax vs plantilla).
 * Ejecutar: npm run eval:custom-cover (raíz) o desde apps/web2
 */
import {
    buildCustomCycleWorkDays,
    buildCustomWeekendInterleavePool,
    buildCustomWeekendRestOptions,
    customCoverDailyPax,
    customCoverDistinctBandCount,
    customCoverRequiredHeadcount,
    customCoverSimultaneousPax,
    customCoverSlotsRequiredOnDay,
    customCoverWeeklyWorkRest,
    customPositionOperatesAllWeek,
    fixedWeekdayCustomUsesModo12,
    francoCodeForPositionDay,
    pickBalancedCustomWorkers,
} from '../src/lib/planificacion/customCoverCycle';
import { isCustomCoverPosition } from '../src/lib/planificacion/autoScheduleEngineV2';
import type { V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const daysInMonth: Date[] = [];
for (let d = 1; d <= 10; d++) daysInMonth.push(new Date(2026, 6, d));

const directorioLv: V2PositionDef = {
    positionName: 'DIRECTORIO',
    qty: 2,
    coverageType: 'custom',
    shifts: [{ code: 'ME', name: 'm ex', hours: 12, days: ['L', 'M', 'X', 'J', 'V'] }],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};

const museoLv: V2PositionDef = {
    positionName: 'Museo',
    qty: 4,
    coverageType: 'custom',
    shifts: [{ code: 'MA', name: 'mañana', hours: 9, days: ['L', 'M', 'X', 'J', 'V'] }],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};

const directorio7d: V2PositionDef = {
    ...directorioLv,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [{ code: 'ME', name: 'm ex', hours: 12 }],
};

assert(!customPositionOperatesAllWeek(directorioLv), 'DIRECTORIO L–V no opera 7 días');
assert(fixedWeekdayCustomUsesModo12(directorioLv), 'DIRECTORIO L–V ME usa Modo 12');
assert(francoCodeForPositionDay(directorioLv, 'S') === 'F', 'DIRECTORIO 12h sábado → F (franco planificado)');
assert(francoCodeForPositionDay(directorioLv, 'D') === 'F', 'DIRECTORIO domingo → F');
assert(francoCodeForPositionDay(directorioLv, 'L') === 'F', 'Lunes laboral → F si franco');

const dirGroup3 = ['faropp', 'g11', 'g12'];
const dirGroup2 = ['faropp', 'g11'];

for (const empId of dirGroup2) {
    const set = buildCustomCycleWorkDays({
        empId,
        pos: directorioLv,
        daysInMonth,
        groupMemberIds: dirGroup2,
        monthStartGlobalDayIndex: 0,
        getDateKey: (d) => `${d.getFullYear()}-07-${String(d.getDate()).padStart(2, '0')}`,
        getDayLetter: (ds) => {
            const d = Number(ds.split('-')[2]);
            const map = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
            return map[new Date(2026, 6, d).getDay()];
        },
    });
    for (let wd = 1; wd <= 3; wd++) {
        const ds = `2026-07-0${wd}`;
        const letter = ['M', 'X', 'J'][wd - 1];
        assert(set.has(ds), `${empId} trabaja ${letter} ${ds} (pax=plantilla)`);
    }
    assert(!set.has('2026-07-04'), `${empId} no trabaja sábado`);
    assert(!set.has('2026-07-05'), `${empId} no trabaja domingo`);
}

const day1Workers = new Set<string>();
dirGroup3.forEach((empId) => {
    const set = buildCustomCycleWorkDays({
        empId,
        pos: directorioLv,
        daysInMonth: daysInMonth.slice(0, 3),
        groupMemberIds: dirGroup3,
        monthStartGlobalDayIndex: 0,
        getDateKey: (d) => `${d.getFullYear()}-07-${String(d.getDate()).padStart(2, '0')}`,
        getDayLetter: (ds) => {
            const d = Number(ds.split('-')[2]);
            const map = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
            return map[new Date(2026, 6, d).getDay()];
        },
    });
    if (set.has('2026-07-01')) day1Workers.add(empId);
});
assert(day1Workers.size === 2, `01/07 DIRECTORIO L–V: 2 guardias con turno, no 3 (tiene ${day1Workers.size})`);

const { workDays: meWork7, cycleLen: meCycle7 } = customCoverWeeklyWorkRest(directorio7d);
assert(meWork7 === 5 && meCycle7 === 7, 'DIRECTORIO 7d ciclo 5+2');

for (let di = 0; di < 7; di++) {
    const workers = pickBalancedCustomWorkers(di, 3, 2, meWork7, meCycle7);
    assert(workers.length === 2, `DIRECTORIO 7d día ${di + 1}: exactamente 2 en servicio (${workers.join(',')})`);
}

const musGroup = ['a', 'b', 'c', 'd', 'e'];
const { workDays: maWork, cycleLen: maCycle } = customCoverWeeklyWorkRest({
    ...museoLv,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [{ code: 'MA', name: 'mañana', hours: 9 }],
});
for (let di = 0; di < 7; di++) {
    const workers = pickBalancedCustomWorkers(di, 5, 4, maWork, maCycle);
    assert(workers.length === 4, `Museo 7d día ${di + 1}: 4 en servicio`);
}

assert(customCoverDailyPax(directorioLv) === 2, 'DIRECTORIO pax 2');
assert(customCoverDailyPax(museoLv) === 4, 'Museo pax 4');

const villaMaria: V2PositionDef = {
    positionName: 'Puesto 1',
    qty: 1,
    coverageType: 'custom',
    shifts: [
        { code: 'M2', name: 'M2', hours: 7, days: ['L', 'M', 'X', 'J', 'V'], startTime: '08:00', endTime: '15:00' },
        { code: 'M', name: 'M', hours: 8, days: ['L', 'M', 'X', 'J', 'V'], startTime: '07:30', endTime: '15:30' },
    ],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};

assert(isCustomCoverPosition(villaMaria), 'Villa Maria es custom (coverageType custom)');
assert(customCoverDistinctBandCount(villaMaria) === 2, 'Villa Maria 2 bandas M + M2');
assert(customCoverRequiredHeadcount(villaMaria) === 2, 'Villa Maria plantilla 2 guardias');
assert(customCoverSlotsRequiredOnDay(villaMaria, 'L', ['6+2']) === 2, 'Villa Maria 2 slots/día L-V');
assert(customCoverSlotsRequiredOnDay(villaMaria, 'S', ['6+2']) === 0, 'Villa Maria sin slots sábado');
assert(francoCodeForPositionDay(villaMaria, 'S') === 'RET', 'Villa Maria sábado 8h → RET');
assert(francoCodeForPositionDay(villaMaria, 'D') === 'F', 'Villa Maria domingo → F (franco planificado)');
assert(francoCodeForPositionDay(directorioLv, 'S') === 'F', 'DIRECTORIO 12h sábado → F');

const vmGroup = ['ferrey', 'aceved'];
const weekdayDatesLv = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07'];
for (const empId of vmGroup) {
    const set = buildCustomCycleWorkDays({
        empId,
        pos: villaMaria,
        daysInMonth,
        groupMemberIds: vmGroup,
        monthStartGlobalDayIndex: 0,
        getDateKey: (d) => `${d.getFullYear()}-07-${String(d.getDate()).padStart(2, '0')}`,
        getDayLetter: (ds) => {
            const d = Number(ds.split('-')[2]);
            const map = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
            return map[new Date(2026, 6, d).getDay()];
        },
    });
    for (const ds of weekdayDatesLv) {
        assert(set.has(ds), `${empId} trabaja día hábil ${ds} (M+M2 fijos)`);
    }
    assert(!set.has('2026-07-04'), `${empId} no trabaja sábado`);
    assert(!set.has('2026-07-05'), `${empId} no trabaja domingo`);
}
assert(customCoverSimultaneousPax(villaMaria) === 2, 'Villa Maria 2 pax simultáneos');

const puestoManana: V2PositionDef = {
    positionName: 'Puesto Mañana',
    qty: 1,
    coverageType: 'custom',
    shifts: [{ code: 'M', name: 'Mañana', hours: 8, days: ['L', 'M', 'X', 'J', 'V'] }],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};
const puestoTarde: V2PositionDef = {
    positionName: 'Puesto Tarde',
    qty: 1,
    coverageType: 'custom',
    shifts: [{ code: 'T', name: 'Tarde', hours: 8, days: ['L', 'M', 'X', 'J', 'V'] }],
    activeDays: ['L', 'M', 'X', 'J', 'V'],
};
const mtPositions = [puestoManana, puestoTarde];
const mtGroups = { 'Puesto Mañana': ['g01'], 'Puesto Tarde': ['g02'] };
const mtPool = buildCustomWeekendInterleavePool(mtPositions, mtGroups);
assert(mtPool.length === 2 && mtPool[0] === 'g01' && mtPool[1] === 'g02', 'pool M+T: 2 guardias en orden de puesto');
const mtScope = { positions: mtPositions, positionGroups: mtGroups };
const mtSat = '2026-07-04';
const g01Sat = francoCodeForPositionDay(
    puestoManana,
    'S',
    buildCustomWeekendRestOptions(puestoManana, 'g01', mtSat, undefined, mtScope),
);
const g02Sat = francoCodeForPositionDay(
    puestoTarde,
    'S',
    buildCustomWeekendRestOptions(puestoTarde, 'g02', mtSat, undefined, mtScope),
);
const g01Sun = francoCodeForPositionDay(
    puestoManana,
    'D',
    buildCustomWeekendRestOptions(puestoManana, 'g01', mtSat, undefined, mtScope),
);
const g02Sun = francoCodeForPositionDay(
    puestoTarde,
    'D',
    buildCustomWeekendRestOptions(puestoTarde, 'g02', mtSat, undefined, mtScope),
);
assert(
    (g01Sat === 'RET' && g02Sat === 'F' && g01Sun === 'F' && g02Sun === 'RET')
    || (g01Sat === 'F' && g02Sat === 'RET' && g01Sun === 'RET' && g02Sun === 'F'),
    `M+T fin de semana intercalado (g01 ${g01Sat}/${g01Sun}, g02 ${g02Sat}/${g02Sun})`,
);
assert(
    (g01Sat === 'RET') !== (g02Sat === 'RET'),
    'sábado: un guardia RET y el otro F',
);
assert(
    (g01Sun === 'RET') !== (g02Sun === 'RET'),
    'domingo: un guardia RET y el otro F',
);

console.log('---');
console.log('Custom cover cycle OK.');
