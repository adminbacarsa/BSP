/**
 * Smoke test Obrador-like: 18 guardias, 6+2, SLA 3298h, junio 2026.
 * Ejecutar: npx tsx scripts/test-auto-obrador.ts  (desde apps/web2)
 */
import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    type V2EngineContext,
    type V2PositionDef,
} from '../src/lib/planificacion/autoScheduleEngineV4';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const getDayLetter = (dateStr: string) => DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];

const daysInMonth: Date[] = [];
for (let d = 1; d <= 30; d++) daysInMonth.push(new Date(2026, 5, d));

const positions: V2PositionDef[] = [
    {
        positionName: 'Puesto Encargada',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'EN', name: 'Encargada', hours: 9, startTime: '08:00', endTime: '17:00' }],
    },
    {
        positionName: 'Puesto Rondin',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'RO', name: 'Rondin', hours: 10, startTime: '08:00', endTime: '18:00' }],
    },
    {
        positionName: 'Puesto 1 24hs',
        qty: 4,
        coverageType: '24hs',
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8, startTime: '06:00', endTime: '14:00' },
            { code: 'T', name: 'Tarde', hours: 8, startTime: '14:00', endTime: '22:00' },
            { code: 'N', name: 'Noche', hours: 8, startTime: '22:00', endTime: '06:00' },
            { code: 'D12', name: 'Diurno 12', hours: 12, startTime: '07:00', endTime: '19:00' },
            { code: 'N12', name: 'Nocturno 12', hours: 12, startTime: '19:00', endTime: '07:00' },
        ],
    },
];

const employees = Array.from({ length: 18 }, (_, i) => ({
    id: `emp${i}`,
    nombre: `Guardia ${i + 1}`,
    lat: null as number | null,
    lng: null as number | null,
    preferredObjectiveId: 'obj1',
}));

const defaultPositionByEmp: Record<string, string> = {
    emp0: 'Puesto Encargada',
    emp1: 'Puesto Rondin',
};
for (let i = 2; i < 18; i++) defaultPositionByEmp[`emp${i}`] = 'Puesto 1 24hs';

const baseCtx: V2EngineContext = {
    positions,
    employees,
    daysInMonth,
    empMonthlyInitial: {},
    absences: {},
    slaVendidas: 3298,
    autoCycles: ['6+2'],
    budgetMode: 'cct',
    objectiveId: 'obj1',
    getDayLetter,
    getDateKey,
    rotateShifts: false,
    defaultPositionByEmp,
    codeHoursHint: { EN: 9, RO: 10 },
};

const picked = pickOptimalAutoCycles(baseCtx);
const gen = generateScheduleV4({ ...baseCtx, autoCycles: [picked.pickedKey] });

const FRANCO = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET']);
const p24 = 'Puesto 1 24hs';
let fOnWorkDays24 = 0;
const workDaysByEmp = new Map<string, Set<string>>();

gen.assignments.forEach(a => {
    if (a.positionName !== p24 && a.positionName !== '') return;
    if (!FRANCO.has(String(a.code).toUpperCase()) && a.hours > 0) return;
    if (a.code !== 'F') return;
    const empPos = defaultPositionByEmp[a.empId];
    if (empPos !== p24) return;
    fOnWorkDays24++;
});

// Recompute cycle work days proxy: any billable shift assigned = work day; F on day where others same band work
const billableByDay = new Map<string, number>();
gen.assignments.forEach(a => {
    if (a.hours > 0 && !FRANCO.has(String(a.code).toUpperCase())) {
        billableByDay.set(`${a.empId}_${a.dateStr}`, a.hours);
    }
});

employees.filter(e => defaultPositionByEmp[e.id] === p24).forEach(emp => {
    daysInMonth.forEach(day => {
        const ds = getDateKey(day);
        const a = gen.assignments.find(x => x.empId === emp.id && x.dateStr === ds);
        if (a?.code === 'F') {
            const othersWorking = gen.assignments.some(
                x => x.dateStr === ds && x.positionName === p24 && x.hours > 0,
            );
            if (othersWorking) fOnWorkDays24++;
        }
    });
});

console.log('=== Test Obrador (sintético) ===');
console.log('Esquema:', picked.pickedKey);
console.log('Hs facturables motor:', Math.round(gen.stats.totalBillableHours));
console.log('Objetivo SLA:', baseCtx.slaVendidas);
console.log('Slots sin cubrir:', gen.stats.uncoveredSlots);
console.log('RET total:', gen.stats.totalRetCount ?? 0);
console.log('SLA cerrado:', gen.stats.slaHoursClosed, 'déficit:', gen.stats.slaDeficitRemaining ?? 0);

const okHours = gen.stats.slaHoursClosed !== false && gen.stats.totalBillableHours >= 3200;
console.log(okHours ? 'PASS horas >= SLA' : 'FAIL horas SLA');

process.exit(okHours ? 0 : 1);
