/**
 * Smoke test demand-driven — 4 puestos 24hs, 16 guardias, junio 2026.
 * npx tsx scripts/test-demand-driven-misericordia.ts
 */
import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    type V2EngineContext,
    type V2PositionDef,
} from '../src/lib/planificacion/autoScheduleEngineV4';
import {
    buildCodeCountsByPositionForDay,
} from '../src/lib/planificacion/positionCoverageUnits';
import { sumDayCoverageFromCodeCounts } from '../src/lib/planificacion/positionCoverageUnits';

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
    positionName: name,
    qty: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [
        { code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 },
        { code: 'D12', hours: 12 }, { code: 'N12', hours: 12 },
    ],
}));

const employees = Array.from({ length: 16 }, (_, i) => ({
    id: `e${i}`,
    nombre: `Guardia ${i}`,
}));

const baseCtx: V2EngineContext = {
    positions,
    employees,
    daysInMonth,
    empMonthlyInitial: Object.fromEntries(employees.map(e => [e.id, 0])),
    absences: {},
    slaVendidas: 2880,
    autoCycles: [],
    getDayLetter,
    getDateKey,
    demandDriven: true,
    rotateShifts: false,
};

const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
baseCtx.autoCycles = picked.cycles;

const gen = generateScheduleV4(baseCtx);
console.log('Esquema:', picked.cycles.join(', '));
console.log('Hs facturables:', Math.round(gen.stats.totalBillableHours), '/ 2880');
console.log('Slots sin cubrir:', gen.stats.uncoveredSlots);

let daysFull = 0;
let daysPartial = 0;
for (const day of daysInMonth) {
    const dateStr = getDateKey(day);
    const dayLetter = getDayLetter(dateStr);
    const byPos: Record<string, Record<string, number>> = {};
    for (const p of positions) byPos[p.positionName] = {};
    for (const a of gen.assignments) {
        if (a.dateStr !== dateStr || !a.hours || a.hours <= 0) continue;
        const pos = a.positionName || 'General';
        const code = String(a.code || '').toUpperCase();
        if (!byPos[pos]) byPos[pos] = {};
        byPos[pos][code] = (byPos[pos][code] || 0) + 1;
    }
    const dayCov = sumDayCoverageFromCodeCounts(positions, dayLetter, byPos, picked.cycles);
    if (dayCov.required === 0) continue;
    if (dayCov.closed >= dayCov.required) daysFull++;
    else daysPartial++;
}
console.log(`Días cobertura: ${daysFull} OK · ${daysPartial} con huecos (de ${daysInMonth.length})`);

if (daysFull < 20) {
    console.error('Esperábamos mayoría de días 4/4');
    process.exit(1);
}
console.log('OK');
