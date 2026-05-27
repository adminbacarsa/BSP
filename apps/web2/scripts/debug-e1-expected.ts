import { generateScheduleV4, pickOptimalAutoCycles, type V2EngineContext, type V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV4';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const getDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getDayLetter = (s: string) => DAY_LETTERS[new Date(`${s}T12:00:00`).getDay()];
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

// Simulate expectedShiftForDay logic for e1
const cycleLen = 8, cL = 6;
const monthStart = Math.round((new Date(2026, 5, 1).getTime() - new Date(2020, 0, 1).getTime()) / 86400000);
const ring = ['M', 'T', 'N'];
const slot = 0; // e1: gi=0 in Puesto 2
const offset = 0; // empGroupIdx = (0*2)%8

for (let d = 1; d <= 15; d++) {
    const ds = getDateKey(new Date(2026, 5, d));
    const di = d - 1;
    const absDay = monthStart + di;
    const cycleSlot = (absDay + offset) % cycleLen;
    const isF = cycleSlot >= cL;
    const cycleStartAbs = absDay + offset - cycleSlot;
    const pendulumBlock = Math.floor(cycleStartAbs / cycleLen);
    const period = 4;
    const pos = (slot + pendulumBlock) % period;
    const idx = pos < 3 ? pos : period - pos;
    const exp = isF ? 'F' : ring[idx];
    const a = gen.assignments.find(x => x.empId === 'e1' && x.dateStr === ds);
    console.log(ds, 'exp=' + exp, 'act=' + (a?.code || 'EMPTY'), cycleSlot, 'block=' + pendulumBlock);
}
