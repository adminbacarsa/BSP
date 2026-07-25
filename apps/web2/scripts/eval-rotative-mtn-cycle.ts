/**
 * Smoke — ciclo 24d M/T/N: equidad de bandas y sin saltos M→N sin franco.
 * npm run eval:rotative-mtn
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateScheduleV4 } from '../src/lib/planificacion/autoScheduleEngineV4';
import type { V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import { buildPositionRequiredHeadcountMap } from '../src/lib/planificacion/objectiveHeadcount';
import { resolveObjectiveScheduleFlags } from '../src/lib/planificacion/scheduleObjectiveFlags';
import {
    assignmentBreaksBandTransition,
    nextAssignmentBreaksBandTransition,
} from '../src/lib/planificacion/rotativeBandGuard';
import { forbiddenMorningToNightWithoutBreak } from '../src/lib/planificacion/restBetweenShifts';

const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

function getDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getDayLetter(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return DAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

function buildCtx(positions: V2PositionDef[], empCount: number): V2EngineContext {
    const days: Date[] = [];
    for (let d = 1; d <= 31; d++) days.push(new Date(2026, 6, d));
    const employees = Array.from({ length: empCount }, (_, i) => ({ id: `g${i + 1}` }));
    const cycleKey = '6+2';
    const headcount = buildPositionRequiredHeadcountMap(positions, cycleKey);
    const defaultPos: Record<string, string> = {};
    let idx = 0;
    for (const pos of positions) {
        const need = headcount[pos.positionName] || 1;
        for (let n = 0; n < need && idx < employees.length; n++) {
            defaultPos[employees[idx].id] = pos.positionName;
            idx++;
        }
    }
    const flags = resolveObjectiveScheduleFlags(positions);
    return {
        positions,
        employees: employees.map((e) => ({ ...e, preferredObjectiveId: 'lab' })),
        daysInMonth: days,
        calendarDaysInMonth: days,
        serviceExcludedDates: [],
        empMonthlyInitial: Object.fromEntries(employees.map((e) => [e.id, 0])),
        absences: {},
        slaVendidas: 2000,
        autoCycles: ['6+2'],
        objectiveId: 'lab',
        defaultPositionByEmp: defaultPos,
        budgetMode: 'cct',
        getDayLetter,
        getDateKey,
        rotateShifts: true,
        ajustarCrono: false,
        modo12Days: [],
        contingencyApretarDays: [],
        apretarCronoDays: [],
        strictSixTwo: false,
        noFlexSchemeEmployees: true,
        allowCustom24hsBackup: flags.allowCustom24hsBackup,
        schedulePhasedRotativeFirst: flags.schedulePhasedRotativeFirst,
        preserveRotativeIntegrity: flags.preserveRotativeIntegrity,
        allowFrancoWorkedRescue: false,
        headcountByPax: true,
    };
}

const puesto24: V2PositionDef = {
    positionName: 'Puesto 1',
    qty: 1,
    coverageType: '24hs',
    shifts: [
        { code: 'M', name: 'Mañana', hours: 8 },
        { code: 'T', name: 'Tarde', hours: 8 },
        { code: 'N', name: 'Noche', hours: 8 },
    ],
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
};

const ctx = buildCtx([puesto24], 4);
const gen = generateScheduleV4(ctx);

assert((gen.stats.uncoveredSlots ?? 0) === 0, '0 huecos SLA con ciclo MTN');

const p1Ids = gen.stats.positionGroups?.['Puesto 1'] || [];
let harshTransitions = 0;
const bandDays: Record<string, Record<string, number>> = {};

for (const empId of p1Ids) {
    bandDays[empId] = { M: 0, T: 0, N: 0 };
    const work = gen.assignments
        .filter((a) => a.empId === empId && a.positionName === 'Puesto 1' && (a.hours ?? 0) > 0)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    for (const a of work) {
        const c = String(a.code).toUpperCase();
        if (c === 'M' || c === 'T' || c === 'N') bandDays[empId][c]++;
        if (assignmentBreaksBandTransition(gen.assignments, empId, a.dateStr, c)) harshTransitions++;
        if (nextAssignmentBreaksBandTransition(gen.assignments, empId, a.dateStr, c)) harshTransitions++;
    }
}

assert(harshTransitions === 0, 'sin transiciones prohibidas (N→*, T→M, M→N sin franco)');
assert(forbiddenMorningToNightWithoutBreak('M', 'N'), 'regla M→N activa');
assert(!forbiddenMorningToNightWithoutBreak('M', 'T'), 'M→T permitido');

for (const empId of p1Ids) {
    const b = bandDays[empId];
    assert(
        Math.max(b.M, b.T, b.N) <= 12 && Math.min(b.M, b.T, b.N) >= 5,
        `${empId}: cada banda entre 5 y 12 días (${b.M}/${b.T}/${b.N})`,
    );
}

const fixture = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'casa-matriz-export.json'), 'utf8'),
);
const mixedCtx = buildCtx(fixture.synthetic.positions, fixture.synthetic.employees.length);
mixedCtx.slaVendidas = fixture.synthetic.slaVendidas;
mixedCtx.employees = fixture.synthetic.employees.map((e: { id: string; nombre?: string }) => ({
    ...e,
    preferredObjectiveId: 'lab',
}));
const mixed = generateScheduleV4(mixedCtx);
assert((mixed.stats.uncoveredSlots ?? 0) === 0, 'Casa Matriz mixto: 0 huecos con ciclo MTN');

console.log('eval-rotative-mtn-cycle: OK');
