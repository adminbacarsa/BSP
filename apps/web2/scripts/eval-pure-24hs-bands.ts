/**
 * Smoke puro 24 HS multipuesto / multipax — auditoría de bandas por día.
 * npm run eval:pure-24hs-bands
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'eval-app';

async function runCase(
    label: string,
    caseDef: import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition,
    employees?: Array<{ id: string; nombre: string }>,
): Promise<boolean> {
    const { auditPure24hsBandCoverage } = await import('../src/lib/planificacion/pure24hsBandAudit');
    const { verifyScheduleCoverage } = await import('../src/lib/planificacion/coverageVerification');
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule, buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { runPlanningGeneration } = await import('../src/lib/planificacion/planningGenerationRouter');

    const year = 2026;
    const month = caseDef.serviceStartDate?.startsWith('2026-08') ? 8 : 7;
    const run = runAutoLabCase(caseDef, year, month, employees ? { employees } : undefined);
    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);
    const raw = runPlanningGeneration(ctx, { strictSixTwo: run.brain.strictSixTwo === true });
    const outcome = generateAutoLabSchedule(caseDef, run);
    const gen = outcome.generation;

    console.log(`\n=== ${label} ===`);
    console.log('motor', outcome.planningRoute?.motorId, outcome.planningRoute?.labelEs);
    if (!gen) {
        console.error('FAIL: sin generación', outcome.error);
        return false;
    }

    const rawAudit = auditPure24hsBandCoverage(ctx, raw.generation.assignments);
    const postAudit = auditPure24hsBandCoverage(ctx, gen.assignments);
    const cov = verifyScheduleCoverage(ctx, gen.assignments, gen.stats);

    console.log('pre-post bandas', rawAudit.ok ? 'OK' : `FAIL (${rawAudit.snapshots.length})`);
    console.log('post bandas', postAudit.ok ? 'OK' : `FAIL (${postAudit.snapshots.length})`);
    console.log('verify uncovered', cov.coverage.uncoveredSlots);
    console.log('closure', outcome.scheduleClosure?.ok, outcome.scheduleClosure?.messages?.join(' | ') ?? '');
    if (outcome.externalRetActions?.length) {
        console.log('externalRet', outcome.externalRetActions.length);
    }

    if (!postAudit.ok) {
        for (const s of postAudit.snapshots.slice(0, 5)) {
            console.log(
                `  ${s.dateStr} ${s.positionName} qty=${s.qty}`,
                'need M/T/N=', s.expectedBands.join('/'),
                'have', JSON.stringify(s.assigned),
                'missing', s.missing,
                'over', s.over,
            );
        }
    }

    const pass = postAudit.ok && (cov.coverage.uncoveredSlots ?? 0) === 0;
    console.log(pass ? 'PASS' : 'FAIL');
    return pass;
}

async function main(): Promise<void> {
    const { AUTO_LAB_CASES } = await import('../src/lib/planificacion/autoLabCaseCatalog');
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    const case03 = AUTO_LAB_CASES.find((c) => c.id === 'case-03-24hs-mtn');
    const case04 = AUTO_LAB_CASES.find((c) => c.id === 'case-04-hospital-4pax');
    const case05 = AUTO_LAB_CASES.find((c) => c.id === 'case-05-pax2-ausencia');

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
    const P2: V2PositionDef['shifts'] = [
        { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
        { code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
    ];

    const obradorPure: AutoLabCaseDefinition = {
        id: 'obrador-pure-24hs',
        order: 99,
        title: 'Obrador puro 24hs',
        subtitle: '3 puestos multipax',
        description: 'Repro export usuario sin custom',
        expectations: [],
        coverageNotes: '',
        positions: [
            { positionName: 'Puesto 3', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
            { positionName: 'Puesto 1', qty: 2, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M1 },
            { positionName: 'Puesto 2', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: P2 },
        ],
        employeeCount: 17,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidas: 2976,
        serviceStartDate: '2026-08-01',
        serviceEndDate: '2026-08-31',
        absencesByDate: [],
    };

    const empIds = [
        '4JF487GdlTAVryEzUu5y', 'AKGLjWVUk6Lg5YlzbYqq', 'KwoasCLVnkz9y2h9MnOL', 'Pl4iHKrGu0qE8HSnDd97',
        'Pv2y0buUkBBYI9BqlBGy', 'W2KasDpuYn6F0JJy8p9V', 'Z6phC2rsjfWQNeCMZZBm', 'bFaCl00LNtrEv4Rco5Ae',
        'fBJeRulBMbWda5irotFO', 'huLeYUKs8K6kLpBePH6H', 'jKWkDpRenTqGyAf5ZphP', 'kF45ARSyrLE1c98l8XHr',
        'nzi2QMhJomLfSsAOEhE2', 'pyaGffZq2RyDgysBDbxT', 't1AUNgFVeHMDv9THxaHD', 'usUePceuvfcF8gO12vHw',
        'vY85ieGn9s0Bcdj7g6ya',
    ];
    const obradorEmployees = empIds.map((id, i) => ({
        id,
        nombre: `G${String(i + 1).padStart(2, '0')}`,
    }));

    let failed = false;
    if (case03) failed = !(await runCase('case-03 testigo 1 puesto', case03)) || failed;
    if (case04) failed = !(await runCase('case-04 hospital 4 puestos', case04)) || failed;
    if (case05) failed = !(await runCase('case-05 pax2', case05)) || failed;
    failed = !(await runCase('Obrador puro 24hs agosto', obradorPure, obradorEmployees)) || failed;

    if (failed) process.exit(1);
    console.log('\n=== eval-pure-24hs-bands PASS ===');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
