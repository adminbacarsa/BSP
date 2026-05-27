/**
 * Bandas fijas (rotateShifts=false): cada guardia solo M, T o N + F/RET del ciclo 6+2.
 */
import { generateScheduleV4, pickOptimalAutoCycles, type V2EngineContext, type V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV4';
import { shouldUseDemandDrivenScheduling } from '../src/lib/planificacion/demandDrivenSchedule';

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
    absences: {}, slaVendidas: 2880, autoCycles: [], getDayLetter, getDateKey, demandDriven: true, rotateShifts: false,
};
ctx.autoCycles = pickOptimalAutoCycles({ ...ctx, autoCycles: [] }).cycles;

if (shouldUseDemandDrivenScheduling(ctx)) {
    console.error('FAIL: bandas fijas no deben usar motor demand-driven');
    process.exit(1);
}

const gen = generateScheduleV4(ctx);
const WORK = new Set(['M', 'T', 'N', 'D12', 'N12']);
let bandJumps = 0;
let illegalBand = 0;

for (const emp of employees) {
    const bands = new Set<string>();
    let streak = '';
    for (const day of days) {
        const ds = getDateKey(day);
        const a = gen.assignments.find(x => x.empId === emp.id && x.dateStr === ds);
        const c = String(a?.code || '').toUpperCase();
        if (!WORK.has(c)) {
            streak = '';
            continue;
        }
        bands.add(c);
        if (bands.size > 1) illegalBand++;
        if (streak && streak !== c) bandJumps++;
        streak = c;
    }
}

const retOnCycleF = gen.assignments.filter(a => a.code === 'RET' && a.hours === 0).length;
console.log('Motor demand-driven:', shouldUseDemandDrivenScheduling(ctx));
console.log('Hs:', gen.stats.totalBillableHours, 'uncovered:', gen.stats.uncoveredSlots);
console.log('Filas con más de una banda laboral:', illegalBand);
console.log('RET stand-by:', retOnCycleF);

const ok = illegalBand === 0;
console.log(ok ? 'PASS bandas fijas limpias' : 'FAIL bandas mezcladas');
process.exit(ok ? 0 : 1);
