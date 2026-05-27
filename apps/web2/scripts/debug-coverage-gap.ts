import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    type V2EngineContext,
    type V2PositionDef,
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
const gen = generateScheduleV4(baseCtx);
const cov = verifyScheduleCoverage(baseCtx, gen.assignments, gen.stats);

const work = gen.assignments.filter(a => (a.hours ?? 0) > 0);
const noPos = work.filter(a => !a.positionName);
console.log('work:', work.length, 'no positionName:', noPos.length);
console.log('stats billable:', gen.stats.totalBillableHours, 'uncovered stats:', gen.stats.uncoveredSlots);
console.log('verify covered:', cov.coverage.coveredSlots, '/', cov.coverage.totalSlots);
console.log('verify billable:', cov.billableHoursGenerated);
console.log('uncovered sample:', cov.uncovered.slice(0, 8).map(u =>
    `${u.dateStr} ${u.positionName} ${u.shiftCode} (${u.qtyAssigned}/${u.qtyRequested})`));

const mc = work.filter(a => String(a.code).toUpperCase() === 'M').length;
const tc = work.filter(a => String(a.code).toUpperCase() === 'T').length;
const nc = work.filter(a => String(a.code).toUpperCase() === 'N').length;
console.log('month band counts M/T/N:', mc, tc, nc, '(expect 120 each)');

const ds = '2026-06-01';
const day1 = work.filter(a => a.dateStr === ds);
console.log('day1 bands:', day1.map(a => `${a.positionName}:${a.code}`).join(', '));

const dupEmpDay = new Set<string>();
let dupCount = 0;
for (const a of work) {
    const k = `${a.empId}__${a.dateStr}`;
    if (dupEmpDay.has(k)) dupCount++;
    dupEmpDay.add(k);
}
console.log('duplicate emp+day work assignments:', dupCount);

const slotOver: string[] = [];
for (const day of daysInMonth) {
    const ds2 = getDateKey(day);
    for (const pos of positions) {
        for (const code of ['M', 'T', 'N']) {
            const n = work.filter(a => a.dateStr === ds2 && a.positionName === pos.positionName && String(a.code).toUpperCase() === code).length;
            if (n > 1) slotOver.push(`${ds2} ${pos.positionName} ${code} x${n}`);
        }
    }
}
console.log('overfilled slots:', slotOver.length, slotOver.slice(0, 5));
