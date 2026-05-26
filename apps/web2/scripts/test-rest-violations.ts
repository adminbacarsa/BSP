/**
 * Escanea la grilla generada buscando violaciones de descanso (12h) y N→T / N→M.
 * npx tsx scripts/test-rest-violations.ts
 */
import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    type V2EngineContext,
    type V2PositionDef,
} from '../src/lib/planificacion/autoScheduleEngineV4';
import {
    checkRestBetweenShifts,
    forbiddenNightToNonNightWithoutBreak,
    type AgreementRestConfig,
} from '../src/lib/planificacion/restBetweenShifts';
import { SUVICO_POLICY } from '../src/lib/planificacion/suvicoPolicy';

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

const cfg: AgreementRestConfig = {
    minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
    longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
    minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
};

const FRANCO = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'V', 'L', 'A', 'E', 'PG', 'AA']);

function buildGetShift(assignments: typeof gen.assignments) {
    return (eid: string, ds: string) => {
        const x = assignments.find(z => z.empId === eid && z.dateStr === ds);
        if (!x) return null;
        const c = String(x.code || '').toUpperCase();
        if (FRANCO.has(c) || (x.hours ?? 0) <= 0) {
            return { code: c, hours: 0, startTime: '00:00' };
        }
        return {
            code: c,
            hours: x.hours,
            startTime: x.startTime || '07:00',
            endTime: (x as { endTime?: string }).endTime,
        };
    };
}

const getShift = buildGetShift(gen.assignments);
let restViol = 0;
let nNonNight = 0;
const samples: string[] = [];

for (const emp of employees) {
    for (const day of daysInMonth) {
        const ds = getDateKey(day);
        const a = gen.assignments.find(x => x.empId === emp.id && x.dateStr === ds && (x.hours ?? 0) > 0);
        if (!a) continue;

        const msg = checkRestBetweenShifts({
            empId: emp.id,
            targetDateStr: ds,
            proposed: { code: a.code, startTime: a.startTime, hours: a.hours },
            getShift,
            cfg,
        });
        if (msg) {
            restViol++;
            if (samples.length < 8) samples.push(`${emp.id} ${ds} ${a.code}: ${msg}`);
        }

        const di = daysInMonth.findIndex(d => getDateKey(d) === ds);
        if (di > 0) {
            const prevDs = getDateKey(daysInMonth[di - 1]);
            const prev = gen.assignments.find(x => x.empId === emp.id && x.dateStr === prevDs && (x.hours ?? 0) > 0);
            const pc = prev ? String(prev.code).toUpperCase() : '';
            const nc = String(a.code).toUpperCase();
            if (forbiddenNightToNonNightWithoutBreak(pc, nc)) nNonNight++;
        }
    }
}

console.log('Hs:', Math.round(gen.stats.totalBillableHours), 'uncovered:', gen.stats.uncoveredSlots);
console.log('Violaciones descanso (12h, sin ciclo):', restViol);
console.log('N→(T/M/…) consecutivos sin franco:', nNonNight);
if (samples.length) {
    console.log('Ejemplos:');
    samples.forEach(s => console.log(' ', s));
}
if (nNonNight > 0) {
    console.error('FAIL: transiciones ilegales tras noche');
    process.exit(1);
}
console.log('OK (sin N→T/M tras noche)');
