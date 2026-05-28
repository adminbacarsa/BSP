import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    type V2EngineContext,
} from '../src/lib/planificacion/autoScheduleEngineV4';
import { verifyScheduleCoverage } from '../src/lib/planificacion/coverageVerification';

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

const positions = ['Puesto 1', 'Puesto 2', '136', 'Internado'].map(name => ({
    positionName: name, qty: 1, coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }],
}));

const employees = Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, nombre: `G${i}` }));

const baseCtx: V2EngineContext = {
    positions, employees, daysInMonth,
    empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
    absences: {}, slaVendidas: 2880, autoCycles: [],
    getDayLetter, getDateKey, demandDriven: true, rotateShifts: false,
};

const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
baseCtx.autoCycles = picked.cycles;
console.log('cycles:', picked.cycles);

const gen = generateScheduleV4(baseCtx);
const cov = verifyScheduleCoverage(baseCtx, gen.assignments, gen.stats);

console.log('billable:', gen.stats.totalBillableHours, 'slaClosed:', gen.stats.slaHoursClosed);
console.log('uncovered stats:', gen.stats.uncoveredSlots, 'verify:', cov.coverage.coveredSlots, '/', cov.coverage.totalSlots);
console.log('RET count:', gen.stats.totalRetCount);
