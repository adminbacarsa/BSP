/**
 * Smoke: H. San Roque — cronograma Auto Lab con excedente + ausencias López/Farias.
 * Esperado: motor floater, 3 sobrantes, sin RET externo para Hall Central (López V).
 */
import {
    generateScheduleV2,
    type V2EmployeeDef,
    type V2EngineContext,
    type V2PositionDef,
} from '../src/lib/planificacion/autoScheduleEngineV2';
import { canUseFixedBandFloater, generateFixedBandFloaterSchedule } from '../src/lib/planificacion/fixedBandFloaterScheduleEngine';

const EXTERNAL_RET_ID_PREFIX = 'lab-ret-ext';

const M_T_N: V2PositionDef['shifts'] = [
    { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
    { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
    { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    { code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00' },
    { code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
];

const positions: V2PositionDef[] = [
    'Puesto Rondin',
    'Puesto Playa',
    'Puesto Hall Central',
    'Puesto Salud Mnetal',
].map((name) => ({
    positionName: name,
    qty: 1,
    coverageType: '24hs' as const,
    shifts: M_T_N,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
}));

const employeeIds = [
    '0KozY27p1igVpCEi3dYI', '1CQAtbfRTj9VOZhki3Xf', '2h1CYgDiuInpBx0cPglf',
    '7M4nUy7XDhsfxHB3g7Hz', 'B4dLwkFxERlo3Zxvxbi9', 'EUOkq4RVYfsY5ZAZ1OUq',
    'MdAhlJ6ACqnBa25dEoRh', 'RVD9nTqF5c4mrfMhDxow', 'U2krcGQjvKc6F6ZQC89A',
    'Z4IyHVJfjBfn0HY3Zg3L', 'Z9w2MhRdifBl8U82nomq', 'cBmM3olST7Pa5MgsUMIr',
    'cwo2Fizijo9ao6slIb64', 'kGTOnyRcEaT6j2HRciA3', 'kUqKPpQiwmdLiWc9A5Gn',
    'lphLITYtzSGrRSxrjh7F', 'nrrs1aBu7cdAZPY00KXp', 'nwNgdtwbkzNQPBC5yg1o',
    'nykgmzvH0qBHDbPpCuqM',
];

const employees: V2EmployeeDef[] = employeeIds.map((id, i) => ({
    id,
    nombre: `Guardia ${i + 1}`,
    preferredObjectiveId: 'auto-lab-case-real-service',
}));

const daysInMonth: Date[] = [];
for (let d = 1; d <= 31; d++) {
    daysInMonth.push(new Date(2026, 6, d));
}

const getDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const getDayLetter = (dateStr: string) => DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];

const rosterSeed: Record<string, string> = {};
let idx = 0;
for (const pos of positions) {
    for (let i = 0; i < 4 && idx < employees.length; i++) {
        rosterSeed[employees[idx].id] = pos.positionName;
        idx += 1;
    }
}

const absences: V2EngineContext['absences'] = {};
for (const empId of ['7M4nUy7XDhsfxHB3g7Hz']) {
    absences[empId] = new Map();
    for (let d = 8; d <= 21; d++) {
        absences[empId].set(`2026-07-${String(d).padStart(2, '0')}`, 'V');
    }
}
for (const empId of ['MdAhlJ6ACqnBa25dEoRh']) {
    absences[empId] = new Map();
    for (let d = 12; d <= 18; d++) {
        absences[empId].set(`2026-07-${String(d).padStart(2, '0')}`, 'V');
    }
}

const ctx: V2EngineContext = {
    positions,
    employees,
    daysInMonth,
    empMonthlyInitial: Object.fromEntries(employees.map((e) => [e.id, 0])),
    absences,
    slaVendidas: 2976,
    autoCycles: ['6+2'],
    rosterSeedByEmp: rosterSeed,
    budgetMode: 'cct',
    getDayLetter,
    getDateKey,
    rotateShifts: true,
    modo12Days: [],
    headcountByPax: true,
    objectiveId: 'auto-lab-case-real-service',
};

let failed = false;
const assert = (cond: boolean, msg: string) => {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        failed = true;
    } else {
        console.log(`OK: ${msg}`);
    }
};

assert(canUseFixedBandFloater(ctx), 'floater disponible para 4×24hs');

const piped = generateFixedBandFloaterSchedule({ ...ctx, rotateShifts: false, demandDriven: false });
const stats = piped.stats;
const assignments = piped.assignments;

const surplus = (() => {
    const pool = new Set<string>(stats.idleEmployeeIds ?? []);
    for (const pos of positions) {
        const need = 4;
        const group = stats.positionGroups?.[pos.positionName] ?? [];
        for (let i = need; i < group.length; i++) pool.add(group[i]);
    }
    return [...pool];
})();
assert(surplus.length === 3, `3 sobrantes (got ${surplus.length}: ${surplus.join(', ')})`);
assert(stats.openingSlotByEmp && Object.keys(stats.openingSlotByEmp).length >= 16, 'openingSlotByEmp del floater');

const lopezDays = ['2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'];
const hall = 'Puesto Hall Central';
const externalHall = assignments.filter((a) =>
    lopezDays.includes(a.dateStr)
    && a.positionName === hall
    && String(a.code || '').toUpperCase() !== 'V'
    && a.empId.startsWith(EXTERNAL_RET_ID_PREFIX),
);
assert(externalHall.length === 0, `sin RET externo en Hall durante V López (got ${externalHall.length})`);

const surplusCoversHall = assignments.filter((a) =>
    lopezDays.includes(a.dateStr)
    && a.positionName === hall
    && surplus.includes(a.empId)
    && ['M', 'T', 'N'].includes(String(a.code || '').toUpperCase()),
);
assert(surplusCoversHall.length >= 5, `flotantes cubren Hall en días López V (got ${surplusCoversHall.length})`);

if (failed) {
    console.error('\n=== eval:san-roque-lab-schedule FAILED ===');
    process.exit(1);
}
console.log('\n=== eval:san-roque-lab-schedule PASS ===');
