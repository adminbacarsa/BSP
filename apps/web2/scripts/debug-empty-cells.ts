import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    type V2EngineContext,
    type V2PositionDef,
} from '../src/lib/planificacion/autoScheduleEngineV4';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getDayLetter = (dateStr: string) => DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];

const daysInMonth: Date[] = [];
for (let d = 1; d <= 30; d++) daysInMonth.push(new Date(2026, 5, d));

const positions: V2PositionDef[] = ['Puesto 1', 'Puesto 2', '136', 'Internado'].map(name => ({
    positionName: name, qty: 1, coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }],
}));

const employees = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, nombre: `G${i}` }));

const baseCtx: V2EngineContext = {
    positions, employees, daysInMonth,
    empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
    absences: {}, slaVendidas: 2880, autoCycles: [],
    getDayLetter, getDateKey, demandDriven: true, rotateShifts: true,
};

baseCtx.autoCycles = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] }).cycles;
const gen = generateScheduleV4(baseCtx);

let empty = 0;
const emptyByDay: Record<string, number> = {};
for (const emp of employees) {
    for (const day of daysInMonth) {
        const ds = getDateKey(day);
        const a = gen.assignments.find(x => x.empId === emp.id && x.dateStr === ds);
        if (!a) {
            empty++;
            emptyByDay[ds] = (emptyByDay[ds] || 0) + 1;
        }
    }
}
console.log('empty cells', empty, '/ 480');
console.log('days with empty:', Object.entries(emptyByDay).filter(([, n]) => n > 0).slice(0, 10));
