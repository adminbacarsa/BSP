/**
 * Smoke: guardia sobrante RET respeta ciclo 6+2 (bloques 6 RET + 2 F).
 * Ejecutar: npm run eval:surplus-ret
 */
import type { V2EngineContext } from '../src/lib/planificacion/autoScheduleEngineV2';
import {
    buildIdleSurplusCycleWorkDays,
    enforceSurplusRetCycleOnAssignments,
    maxConsecutiveRetForCycle,
    maxConsecutiveRetStreak,
    surplusStandbyCodeForDay,
} from '../src/lib/planificacion/surplusRetCycle';
import type { V2Assignment } from '../src/lib/planificacion/autoScheduleEngineV2';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
    console.log(`OK: ${msg}`);
}

const SURPLUS_ID = 'surplus-1';
const daysInMonth: Date[] = [];
for (let d = 1; d <= 31; d++) daysInMonth.push(new Date(2026, 6, d));

const getDateKey = (day: Date) => {
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};

const getDayLetter = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const map = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    return map[d.getDay()];
};

const ctx: V2EngineContext = {
    employees: [
        { id: 'w-0', nombre: 'Worker 0' },
        { id: SURPLUS_ID, nombre: 'Surplus RET' },
    ],
    positions: [{
        positionName: 'Puesto 1',
        qty: 1,
        coverageType: '24hs',
        shifts: [{ code: 'M', hours: 8 }],
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    }],
    daysInMonth,
    getDateKey,
    getDayLetter,
    autoCycles: ['6+2'],
    absences: {},
    rotateShifts: true,
    defaultPositionByEmp: { [SURPLUS_ID]: 'Puesto 1' },
};

const workDays = buildIdleSurplusCycleWorkDays(ctx, SURPLUS_ID);
assert(workDays.size >= 22 && workDays.size <= 25, `~23-24 días laborables en 6+2 (got ${workDays.size})`);

let retOnRest = 0;
let fOnWork = 0;
for (const day of daysInMonth) {
    const ds = getDateKey(day);
    const code = surplusStandbyCodeForDay(ctx, SURPLUS_ID, ds);
    if (!workDays.has(ds) && code === 'RET') retOnRest += 1;
    if (workDays.has(ds) && code === 'F') fOnWork += 1;
}
assert(retOnRest === 0, 'sin RET en días de franco del ciclo');
assert(fOnWork === 0, 'sin F en días laborables del ciclo');

const filled: V2Assignment[] = [];
for (const day of daysInMonth) {
    const ds = getDateKey(day);
    const code = surplusStandbyCodeForDay(ctx, SURPLUS_ID, ds);
    filled.push({
        empId: SURPLUS_ID,
        dateStr: ds,
        positionName: '',
        code,
        name: code === 'RET' ? 'Retén' : 'Franco',
        hours: 0,
        startTime: '00:00',
        isFranco: code === 'F',
        isReten: code === 'RET',
    });
}
// Simula celdas mal asignadas (RET en franco) y corrige con enforce
for (const a of filled) {
    if (!buildIdleSurplusCycleWorkDays(ctx, SURPLUS_ID).has(a.dateStr)) {
        a.code = 'RET';
        a.isReten = true;
        a.isFranco = false;
    }
}
enforceSurplusRetCycleOnAssignments(filled, ctx, SURPLUS_ID, [SURPLUS_ID]);

const maxRet = maxConsecutiveRetStreak(filled, SURPLUS_ID, daysInMonth, getDateKey);
const maxAllowed = maxConsecutiveRetForCycle(ctx);
assert(maxRet <= maxAllowed, `máx ${maxAllowed} RET seguidos (got ${maxRet})`);

let wrongCells = 0;
for (const day of daysInMonth) {
    const ds = getDateKey(day);
    const cell = filled.find((a) => a.empId === SURPLUS_ID && a.dateStr === ds);
    if (!cell) {
        wrongCells += 1;
        continue;
    }
    const expected = surplusStandbyCodeForDay(ctx, SURPLUS_ID, ds);
    if (cell.code !== expected) wrongCells += 1;
}
assert(wrongCells === 0, 'enforceSurplusRetCycle alinea RET/F al ciclo 6+2');

const fCount = filled.filter((a) => a.empId === SURPLUS_ID && a.code === 'F').length;
const retCount = filled.filter((a) => a.empId === SURPLUS_ID && a.code === 'RET').length;
assert(fCount >= 6 && fCount <= 10, `francos del mes razonables (${fCount})`);
assert(retCount >= 20 && retCount <= 26, `RET laborables del mes razonables (${retCount})`);

console.log('\n=== eval:surplus-ret PASS ===');
