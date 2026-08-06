/**
 * Smoke roster 24hs: 3 puestos × 4 = 12 legajos, sin excedente fantasma.
 * npm run eval:planning-roster-24hs
 */
import type { V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';
import { buildPlanningRunPlan24hs } from '../src/lib/planificacion/planningRunPlan';
import { allocate24hsRotationRoster } from '../src/lib/planificacion/planningRoster24hs';
import { prepare24hsPlanningContext } from '../src/lib/planificacion/planningOrchestrator24hs';

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

function puesto24hs(name: string): V2PositionDef {
    return {
        positionName: name,
        qty: 1,
        coverageType: '24hs',
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8 },
            { code: 'T', name: 'Tarde', hours: 8 },
            { code: 'N', name: 'Noche', hours: 8 },
        ],
    };
}

function assert(cond: boolean, msg: string): void {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('OK:', msg);
}

const positions = [puesto24hs('Ingreso'), puesto24hs('Guardia'), puesto24hs('Rondin')];
const days: Date[] = [];
for (let d = 1; d <= 30; d++) days.push(new Date(2026, 7, d));

const employees = Array.from({ length: 12 }, (_, i) => ({
    id: `g${i + 1}`,
    nombre: `Guardia ${i + 1}`,
    preferredObjectiveId: 'obj',
}));

const defaultPositionByEmp: Record<string, string> = {};
positions.forEach((pos, pi) => {
    for (let j = 0; j < 4; j++) {
        defaultPositionByEmp[employees[pi * 4 + j].id] = pos.positionName;
    }
});

const ctx: V2EngineContext = {
    positions,
    employees,
    daysInMonth: days,
    calendarDaysInMonth: days,
    serviceExcludedDates: [],
    empMonthlyInitial: Object.fromEntries(employees.map((e) => [e.id, 0])),
    absences: {},
    slaVendidas: 2160,
    autoCycles: ['6+2'],
    objectiveId: 'obj',
    defaultPositionByEmp,
    getDayLetter,
    getDateKey,
    rotateShifts: false,
};

const plan = buildPlanningRunPlan24hs(ctx);
assert(plan != null && plan.structuralHeadcount === 12, 'plan 3×4=12');

const roster = allocate24hsRotationRoster(ctx, plan!);
assert(roster.ok, 'roster ok');
assert(roster.floaters.length === 0, 'sin floaters con 12 legajos');
for (const pos of positions) {
    assert((roster.positionGroups[pos.positionName]?.length ?? 0) === 4, `${pos.positionName} tiene 4`);
}

const prepared = prepare24hsPlanningContext(ctx);
assert(prepared.ok, 'prepare ok');
assert(prepared.ctx.planningRoster24hs?.floaters.length === 0, 'ctx sin floaters');

console.log('\n=== eval planning-roster-24hs OK (roster) ===');
