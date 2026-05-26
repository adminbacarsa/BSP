/**
 * Verifica péndulo M→T→N→T con rotateShifts ON (6+2, junio 2026).
 * npx tsx scripts/test-rotation-pendulum.ts
 */
import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    pickRepresentativeCycle,
    type V2EngineContext,
    type V2PositionDef,
} from '../src/lib/planificacion/autoScheduleEngineV4';
import { countWorkStreakBandJumps, countForbiddenNightToNonNightTransitions } from '../src/lib/planificacion/demandDrivenSchedule';

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

const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
baseCtx.autoCycles = picked.cycles;
const { cL } = pickRepresentativeCycle(picked.cycles);

const gen = generateScheduleV4(baseCtx);
const emp0 = employees[0].id;

const bandsByBlock: string[] = [];
let current = '';
let blockLen = 0;
for (const day of daysInMonth) {
    const ds = getDateKey(day);
    const a = gen.assignments.find(x => x.empId === emp0 && x.dateStr === ds && (x.hours ?? 0) > 0);
    const code = a ? String(a.code).toUpperCase() : 'F';
    if (code === current || current === '') {
        current = code;
        blockLen++;
    } else {
        if (current && current !== 'F') bandsByBlock.push(`${current}x${blockLen}`);
        current = code;
        blockLen = 1;
    }
}
if (current && current !== 'F') bandsByBlock.push(`${current}x${blockLen}`);

let totalJumps = 0;
let totalRet = 0;
for (const emp of employees) {
    totalJumps += countWorkStreakBandJumps(gen.assignments, baseCtx, emp.id);
    totalRet += gen.assignments.filter(a => a.empId === emp.id && String(a.code).toUpperCase() === 'RET').length;
}

console.log('Esquema:', picked.cycles.join(', '), `(cL=${cL})`);
console.log('Secuencia e0 (bloques):', bandsByBlock.join(' → '));
console.log('Hs:', Math.round(gen.stats.totalBillableHours), 'uncovered:', gen.stats.uncoveredSlots);
console.log('Saltos de banda mid-racha (todos):', totalJumps);
console.log('Celdas RET (todas):', totalRet);

const nmViolations = countForbiddenNightToNonNightTransitions(gen.assignments, baseCtx);
console.log('Transiciones N→(T/M/…) sin franco:', nmViolations);

const hasPendulum = bandsByBlock.some(b => b.startsWith('M')) &&
    bandsByBlock.some(b => b.startsWith('T')) &&
    bandsByBlock.some(b => b.startsWith('N'));
if (!hasPendulum) {
    console.error('FAIL: no se ve péndulo M/T/N');
    process.exit(1);
}
if (gen.stats.uncoveredSlots !== 0 || Math.round(gen.stats.totalBillableHours) !== 2880) {
    console.error('FAIL: SLA no cerrado');
    process.exit(1);
}
if (nmViolations > 0) {
    console.error(`FAIL: ${nmViolations} transiciones tras noche sin franco intermedio`);
    process.exit(1);
}
if (totalJumps > 4) {
    console.warn(`WARN: ${totalJumps} saltos mid-racha (objetivo: bloques ${cL}+2 homogéneos)`);
}
console.log('OK — SLA + péndulo M/T/N');
