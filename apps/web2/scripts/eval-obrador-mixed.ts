/**
 * Smoke Obrador Malagueño mixto: custom L–V + 24hs (Puesto 1 pax=2).
 * Ejecutar: npm run eval:obrador-mixed
 */
import { generateScheduleV4, pickOptimalAutoCycles, type V2EngineContext, type V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV4';
import { buildObjectiveCoverageDemand } from '../src/lib/planificacion/objectiveCoverageDemand';
import { positionIsActiveOn } from '../src/lib/planificacion/autoScheduleEngineV2';
import { analyzeCoveragePolicyBalance } from '../src/lib/planificacion/coveragePolicyBalance';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const getDayLetter = (dateStr: string) => DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];

const daysInMonth: Date[] = [];
for (let d = 1; d <= 31; d++) daysInMonth.push(new Date(2026, 6, d));

const positions: V2PositionDef[] = [
    {
        positionName: 'Puesto Encargada',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'EN', name: 'Encargada', hours: 9, startTime: '08:00', endTime: '17:00', days: ['V', 'L', 'M', 'X', 'J'] }],
    },
    {
        positionName: 'Puesto Rondin',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'RO', name: 'Rondin', hours: 10, startTime: '08:00', endTime: '18:00', days: ['V', 'L', 'M', 'X', 'J'] }],
    },
    {
        positionName: 'Puesto 3',
        qty: 1,
        coverageType: '24hs',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
            { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
            { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
        ],
    },
    {
        positionName: 'Puesto 1',
        qty: 2,
        coverageType: '24hs',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
            { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
            { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
        ],
    },
    {
        positionName: 'Puesto 2',
        qty: 1,
        coverageType: '24hs',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
            { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
            { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
        ],
    },
];

const employees = Array.from({ length: 19 }, (_, i) => ({
    id: `emp${i}`,
    nombre: `Guardia ${i + 1}`,
    lat: null as number | null,
    lng: null as number | null,
    preferredObjectiveId: 'obj-obrador',
}));

const baseCtx: V2EngineContext = {
    positions,
    employees,
    daysInMonth,
    empMonthlyInitial: {},
    absences: {},
    slaVendidas: 3413,
    autoCycles: ['6+2'],
    budgetMode: 'cct',
    objectiveId: 'obj-obrador',
    getDayLetter,
    getDateKey,
    rotateShifts: true,
    schedulePhasedRotativeFirst: true,
    headcountByPax: true,
};

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
    console.log(`OK: ${msg}`);
}

const picked = pickOptimalAutoCycles(baseCtx);
const gen = generateScheduleV4({ ...baseCtx, autoCycles: [picked.pickedKey] });

const weekendDays = daysInMonth
    .map((d) => getDateKey(d))
    .filter((ds) => ['S', 'D'].includes(getDayLetter(ds)));

const pos24 = new Set(['Puesto 1', 'Puesto 2', 'Puesto 3']);
const billableWeekend = gen.assignments.filter((a) => {
    if (!weekendDays.includes(a.dateStr)) return false;
    if (!pos24.has(a.positionName)) return false;
    return (Number(a.hours) || 0) > 0 && ['M', 'T', 'N', 'D12', 'N12'].includes(String(a.code).toUpperCase());
});

const weekendDemand = buildObjectiveCoverageDemand(
    positions,
    weekendDays.map((dateStr) => ({ dateStr, dayLetter: getDayLetter(dateStr) })),
    baseCtx.autoCycles,
    (pos, letter) => positionIsActiveOn(pos as V2PositionDef, letter),
);
const weekendSlotsRequired = weekendDemand.reduce(
    (s, d) => s + Object.values(d.totalBandSlots).reduce((a, n) => a + n, 0),
    0,
);

const balance = analyzeCoveragePolicyBalance(baseCtx, gen.assignments);
const weekendUnder = balance.underCoverage.filter((u) => weekendDays.includes(u.dateStr));

console.log('=== eval:obrador-mixed ===');
console.log('Hs facturables:', Math.round(gen.stats.totalBillableHours));
console.log('Huecos SLA motor:', gen.stats.uncoveredSlots);
console.log('Huecos balance:', balance.underSlotCount);
console.log('Slots 24hs fin de semana requeridos:', weekendSlotsRequired);
console.log('Asignaciones billables 24hs fin de semana:', billableWeekend.length);
console.log('Huecos balance fin de semana:', weekendUnder.reduce((s, u) => s + Math.abs(u.delta), 0));

assert(billableWeekend.length > 0, '24hs trabaja fines de semana (no solo F)');
assert(weekendSlotsRequired > 0, 'demanda SLA incluye fines de semana 24hs');
assert(
    billableWeekend.length >= weekendSlotsRequired * 0.5,
    `cobertura weekend razonable (${billableWeekend.length} vs ${weekendSlotsRequired} slots)`,
);

const p1WeekendM = gen.assignments.filter(
    (a) => a.positionName === 'Puesto 1' && weekendDays.includes(a.dateStr) && String(a.code).toUpperCase() === 'M',
);
assert(p1WeekendM.length >= 2, `Puesto 1 pax=2 tiene M en finde (${p1WeekendM.length} celdas)`);

// Smoke adicional: 24hs con activeDays L–V (bug SLA mixto) debe rotar fin de semana.
const positionsLvBug: V2PositionDef[] = positions.map((p) => {
    if (p.coverageType !== '24hs') return p;
    return {
        ...p,
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: (p.shifts || []).map((s) => ({ ...s, days: ['L', 'M', 'X', 'J', 'V'] })),
    };
});
const genLv = generateScheduleV4({ ...baseCtx, positions: positionsLvBug, autoCycles: [picked.pickedKey] });
const billLv = genLv.assignments.filter((a) => {
    if (!weekendDays.includes(a.dateStr)) return false;
    if (!pos24.has(a.positionName)) return false;
    return (Number(a.hours) || 0) > 0 && ['M', 'T', 'N'].includes(String(a.code).toUpperCase());
});
assert(billLv.length > 0, `24hs con activeDays L–V en SLA sigue cubriendo finde (${billLv.length} turnos)`);

console.log('=== eval:obrador-mixed PASS ===');
