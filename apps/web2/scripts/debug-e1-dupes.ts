import { generateScheduleV4, pickOptimalAutoCycles, type V2EngineContext, type V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV4';

const getDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getDayLetter = (s: string) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(`${s}T12:00:00`).getDay()];
const days = Array.from({ length: 30 }, (_, i) => new Date(2026, 5, i + 1));
const positions: V2PositionDef[] = ['Puesto 1', 'Puesto 2', '136', 'Internado'].map(n => ({
    positionName: n, qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }],
}));
const employees = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, nombre: `G${i}` }));
const ctx: V2EngineContext = {
    positions, employees, daysInMonth: days, empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
    absences: {}, slaVendidas: 2880, autoCycles: [], getDayLetter, getDateKey, demandDriven: true, rotateShifts: true,
};
ctx.autoCycles = pickOptimalAutoCycles({ ...ctx, autoCycles: [] }).cycles;
const gen = generateScheduleV4(ctx);

for (let d = 6; d <= 12; d++) {
    const ds = getDateKey(new Date(2026, 5, d));
    const all = gen.assignments.filter(x => x.empId === 'e1' && x.dateStr === ds);
    console.log(ds, all.map(a => `${a.code} h=${a.hours} pos=${a.positionName}`).join(' | ') || 'NONE');
}
