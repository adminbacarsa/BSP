/**
 * Smoke Obrador Malagueño — 17 legajos reales + agosto 3375h (repro export usuario).
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'eval-app';

async function main(): Promise<void> {
    const typeCase = await import('../src/lib/planificacion/autoLabCaseCatalog');
    const typeV2 = await import('../src/lib/planificacion/autoScheduleEngineV2');
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule, buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { resolvePlanningGenerationRoute, runPlanningGeneration } = await import('../src/lib/planificacion/planningGenerationRouter');
    const { isLabPaddingEmpId } = await import('../src/lib/planificacion/objectiveHeadcount');

    void typeCase;
    void typeV2;

const M_T_N: V2PositionDef['shifts'] = [
    { code: 'M', name: 'Mañana', hours: 8, startTime: '06:00', endTime: '14:00' },
    { code: 'T', name: 'Tarde', hours: 8, startTime: '14:00', endTime: '22:00' },
    { code: 'N', name: 'Noche', hours: 8, startTime: '22:00', endTime: '06:00' },
    { code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '06:00', endTime: '18:00' },
    { code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '18:00', endTime: '06:00' },
];

const M1: V2PositionDef['shifts'] = [
    { code: 'M', name: 'Mañana', hours: 8, startTime: '08:00', endTime: '16:00' },
    { code: 'T', name: 'Tarde', hours: 8, startTime: '16:00', endTime: '00:00' },
    { code: 'N', name: 'Noche', hours: 8, startTime: '00:00', endTime: '08:00' },
    { code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '08:00', endTime: '20:00' },
    { code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '20:00', endTime: '08:00' },
];

const positions: V2PositionDef[] = [
    {
        positionName: 'Puesto Encargada',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'EN', name: 'Encargada', hours: 9, startTime: '08:00', endTime: '17:00', days: ['V', 'L', 'M', 'X', 'J'] }],
    },
    {
        positionName: 'Puesto Rondin',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'RO', name: 'Rondin', hours: 10, startTime: '08:00', endTime: '18:00', days: ['V', 'L', 'M', 'X', 'J'] }],
    },
    { positionName: 'Puesto 3', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
    { positionName: 'Puesto 1', qty: 2, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M1 },
    {
        positionName: 'Puesto 2',
        qty: 1,
        coverageType: '24hs',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: [
            { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
            { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
            { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
            { code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00' },
            { code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
        ],
    },
];

const employeeRows: Array<{ id: string; nombre: string }> = [
    { id: '4JF487GdlTAVryEzUu5y', nombre: 'BAIGORRIA' },
    { id: 'AKGLjWVUk6Lg5YlzbYqq', nombre: 'MORALES' },
    { id: 'KwoasCLVnkz9y2h9MnOL', nombre: 'BARRIOS' },
    { id: 'Pl4iHKrGu0qE8HSnDd97', nombre: 'GOYOCHEA' },
    { id: 'Pv2y0buUkBBYI9BqlBGy', nombre: 'ROMERO' },
    { id: 'W2KasDpuYn6F0JJy8p9V', nombre: 'VIDELA' },
    { id: 'Z6phC2rsjfWQNeCMZZBm', nombre: 'RODRIGUEZ' },
    { id: 'bFaCl00LNtrEv4Rco5Ae', nombre: 'ARAYA' },
    { id: 'fBJeRulBMbWda5irotFO', nombre: 'HERRERA' },
    { id: 'huLeYUKs8K6kLpBePH6H', nombre: 'PALACIOS' },
    { id: 'jKWkDpRenTqGyAf5ZphP', nombre: 'KASIANCHUK' },
    { id: 'kF45ARSyrLE1c98l8XHr', nombre: 'CORONEL' },
    { id: 'nzi2QMhJomLfSsAOEhE2', nombre: 'LUCERO' },
    { id: 'pyaGffZq2RyDgysBDbxT', nombre: 'BORDINO' },
    { id: 't1AUNgFVeHMDv9THxaHD', nombre: 'MARTINEZ' },
    { id: 'usUePceuvfcF8gO12vHw', nombre: 'HERRANTE' },
    { id: 'vY85ieGn9s0Bcdj7g6ya', nombre: 'DIAZ' },
];

const employees: V2EmployeeDef[] = employeeRows.map((e) => ({
    ...e,
    preferredObjectiveId: 'auto-lab-case-real-service',
}));

const caseDef: AutoLabCaseDefinition = {
    id: 'case-real-service',
    order: 6,
    title: 'OBRADOR MALAGUEÑO',
    subtitle: 'CASISA',
    description: '17 legajos',
    expectations: [],
    coverageNotes: '',
    positions,
    employeeCount: 17,
    cycle: '6+2',
    rotationMode: 'rotative',
    slaVendidas: 3375,
    serviceStartDate: '2026-08-01',
    serviceEndDate: '2026-08-31',
    absencesByDate: [],
};

    const run = runAutoLabCase(caseDef, 2026, 8, { employees });
    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);
    const route = resolvePlanningGenerationRoute(ctx, { strictSixTwo: run.brain.strictSixTwo === true });
    const raw = runPlanningGeneration(ctx, { strictSixTwo: run.brain.strictSixTwo === true });
    console.log('motor', route.motorId, route.labelEs, 'pre-post hs', raw.generation.stats.totalBillableHours);
    const outcome = generateAutoLabSchedule(caseDef, run);
    const gen = outcome.generation;

let failed = false;
const assert = (ok: boolean, msg: string) => {
    if (!ok) {
        console.error('FAIL:', msg);
        failed = true;
    } else console.log('OK:', msg);
};

console.log('=== eval obrador 17 legajos ===');
console.log('roster size', run.employees.length, 'pads', run.employees.filter((e) => isLabPaddingEmpId(e.id)).length);
console.log('brain supply', run.brain.diagnosis?.supply);
console.log('pipeline', outcome.pipeline);
console.log('billable', gen?.stats.totalBillableHours, 'uncovered', gen?.stats.uncoveredSlots);
console.log('closure', outcome.scheduleClosure?.ok, outcome.scheduleClosure?.messages);

const pg = gen?.stats.positionGroups ?? {};
const padIn24 = Object.entries(pg).some(
    ([name, ids]) => name.startsWith('Puesto') && ids.some((id) => isLabPaddingEmpId(id)),
);

assert(run.employees.length === 18, `plantilla 18 efectivos (got ${run.employees.length})`);
assert(run.employees.filter((e) => isLabPaddingEmpId(e.id)).length === 1, 'un solo lab-pad');
assert((run.brain.diagnosis?.supply?.peopleAvailable ?? 0) === 18, 'brain peopleAvailable=18');
assert(!padIn24, 'lab-pad fuera de positionGroups 24hs');
assert((gen?.stats.uncoveredSlots ?? 99) <= 5, `huecos <=5 (got ${gen?.stats.uncoveredSlots})`);

if (failed) process.exit(1);
console.log('PASS');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
