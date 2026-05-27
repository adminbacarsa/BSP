/**
 * Diagnóstico: bandas esperadas día 1 y cobertura M/T/N por día.
 * npx tsx scripts/debug-day1-bands.ts
 */
import {
    generateScheduleV4,
    pickOptimalAutoCycles,
    pickRepresentativeCycle,
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

const picked = pickOptimalAutoCycles({ ...baseCtx, autoCycles: [] });
baseCtx.autoCycles = picked.cycles;
const { cL, cF } = pickRepresentativeCycle(picked.cycles);
const cycleLen = cL + cF;

const gen = generateScheduleV4(baseCtx);

// Cobertura por día
for (let di = 0; di < 5; di++) {
    const ds = getDateKey(daysInMonth[di]);
    const work = gen.assignments.filter(a => a.dateStr === ds && (a.hours ?? 0) > 0);
    const mc = work.filter(a => String(a.code).toUpperCase() === 'M').length;
    const tc = work.filter(a => String(a.code).toUpperCase() === 'T').length;
    const nc = work.filter(a => String(a.code).toUpperCase() === 'N').length;
    console.log(`${ds}: M=${mc} T=${tc} N=${nc} (need 4 each)`);
}

// Stagger del contexto (si quedó en stats)
console.log('stagger:', baseCtx.demandDrivenStaggerByEmp);

// Por empleado día 1
const ds1 = getDateKey(daysInMonth[0]);
console.log('\nDía 1 por empleado:');
for (const emp of employees) {
    const a = gen.assignments.find(x => x.empId === emp.id && x.dateStr === ds1);
    const code = a ? String(a.code).toUpperCase() : 'VACIO';
    const pos = a?.positionName || '-';
    const hrs = a?.hours ?? 0;
    console.log(`  ${emp.id}: ${code} pos=${pos} hrs=${hrs}`);
}

console.log('\nEsquema:', picked.cycles.join(', '), `cL=${cL} cF=${cF} cycleLen=${cycleLen}`);

const ANCHOR = new Date(2020, 0, 1);
const monthStart = Math.round((daysInMonth[0].getTime() - ANCHOR.getTime()) / 86_400_000);
console.log('monthStartGlobalDayIndex:', monthStart, 'day1 abs:', monthStart);

// Simular bandas esperadas con i%8 / i%3 (override demand-driven)
const ring = ['M', 'T', 'N'];
const period = 4;
for (const di of [0, 1, 2, 3]) {
    const absDay = monthStart + di;
    const bands: Record<string, number> = { M: 0, T: 0, N: 0, F: 0 };
    for (let i = 0; i < 16; i++) {
        const offset = i % cycleLen;
        const slot = i % ring.length;
        const cycleSlot = (absDay + offset) % cycleLen;
        if (cycleSlot >= cL) { bands.F++; continue; }
        const pendulumBlock = Math.floor((absDay + offset - cycleSlot) / cycleLen);
        const pos = (slot + pendulumBlock) % period;
        const idx = pos < ring.length ? pos : period - pos;
        bands[ring[idx]]++;
    }
    console.log(`expected di=${di} abs%8=${absDay % 8}:`, bands);
}
