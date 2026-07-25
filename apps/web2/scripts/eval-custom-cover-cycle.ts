/**
 * Smoke — rotación custom MA/ME (pax vs plantilla).
 * Ejecutar: npm run eval:custom-cover (raíz) o desde apps/web2
 */
import {
    buildCustomCycleWorkDays,
    customCoverDailyPax,
    customCoverWeeklyWorkRest,
    customPositionOperatesAllWeek,
    fixedWeekdayCustomUsesModo12,
    francoCodeForPositionDay,
    pickBalancedCustomWorkers,
} from '../src/lib/planificacion/customCoverCycle';
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
assert(francoCodeForPositionDay(directorioLv, 'S') === 'FF', 'Sábado → FF');
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

console.log('---');
console.log('Custom cover cycle OK.');
