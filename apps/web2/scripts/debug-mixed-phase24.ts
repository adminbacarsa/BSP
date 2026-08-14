process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'eval-app';

async function main(): Promise<void> {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { buildObjectiveScheduleProfile } = await import('../src/lib/planificacion/objectiveServiceModel');
    const { buildPlanningRunPlan24hs } = await import('../src/lib/planificacion/planningRunPlan');
    const { allocate24hsRotationRoster, applyPlanningRoster24hsToContext } = await import('../src/lib/planificacion/planningRoster24hs');
    const { generateFixedBandFloaterSchedule } = await import('../src/lib/planificacion/fixedBandFloaterScheduleEngine');
    const { generateScheduleV2 } = await import('../src/lib/planificacion/autoScheduleEngineV2');

    const employees = [
        '4JF487GdlTAVryEzUu5y', 'AKGLjWVUk6Lg5YlzbYqq', 'KwoasCLVnkz9y2h9MnOL', 'Pl4iHKrGu0qE8HSnDd97',
        'Pv2y0buUkBBYI9BqlBGy', 'W2KasDpuYn6F0JJy8p9V', 'Z6phC2rsjfWQNeCMZZBm', 'bFaCl00LNtrEv4Rco5Ae',
        'fBJeRulBMbWda5irotFO', 'huLeYUKs8K6kLpBePH6H', 'jKWkDpRenTqGyAf5ZphP', 'kF45ARSyrLE1c98l8XHr',
        'nzi2QMhJomLfSsAOEhE2', 'pyaGffZq2RyDgysBDbxT', 't1AUNgFVeHMDv9THxaHD', 'usUePceuvfcF8gO12vHw',
        'vY85ieGn9s0Bcdj7g6ya',
    ].map((id, i) => ({ id, nombre: `E${i}`, preferredObjectiveId: 'x' }));

    const M1 = [
        { code: 'M', name: 'M', hours: 8, startTime: '08:00', endTime: '16:00' },
        { code: 'T', name: 'T', hours: 8, startTime: '16:00', endTime: '00:00' },
        { code: 'N', name: 'N', hours: 8, startTime: '00:00', endTime: '08:00' },
        { code: 'D12', name: 'D12', hours: 12, startTime: '08:00', endTime: '20:00' },
        { code: 'N12', name: 'N12', hours: 12, startTime: '20:00', endTime: '08:00' },
    ];
    const M_T_N = [
        { code: 'M', name: 'M', hours: 8, startTime: '06:00', endTime: '14:00' },
        { code: 'T', name: 'T', hours: 8, startTime: '14:00', endTime: '22:00' },
        { code: 'N', name: 'N', hours: 8, startTime: '22:00', endTime: '06:00' },
        { code: 'D12', name: 'D12', hours: 12, startTime: '06:00', endTime: '18:00' },
        { code: 'N12', name: 'N12', hours: 12, startTime: '18:00', endTime: '06:00' },
    ];
    const positions = [
        { positionName: 'Puesto Encargada', qty: 1, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V'], shifts: [{ code: 'EN', name: 'EN', hours: 9, startTime: '08:00', endTime: '17:00', days: ['V', 'L', 'M', 'X', 'J'] }] },
        { positionName: 'Puesto Rondin', qty: 1, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V'], shifts: [{ code: 'RO', name: 'RO', hours: 10, startTime: '08:00', endTime: '18:00', days: ['V', 'L', 'M', 'X', 'J'] }] },
        { positionName: 'Puesto 3', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
        { positionName: 'Puesto 1', qty: 2, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M1 },
        { positionName: 'Puesto 2', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [
            { code: 'M', name: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
            { code: 'T', name: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
            { code: 'N', name: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
            { code: 'D12', name: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
            { code: 'N12', name: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
        ] },
    ];
    const caseDef = {
        id: 'c', order: 1, title: 't', subtitle: 's', description: 'd', expectations: [], coverageNotes: '',
        positions, employeeCount: 17, cycle: '6+2', rotationMode: 'rotative', slaVendidas: 3375,
        serviceStartDate: '2026-08-01', serviceEndDate: '2026-08-31', absencesByDate: [],
    };
    const run = runAutoLabCase(caseDef as any, 2026, 8, { employees });
    const ctx = buildAutoLabGenContext(caseDef as any, run, run.brain);
    const sampleEmp = 'KwoasCLVnkz9y2h9MnOL';
    const sampleDate = '2026-08-04';
    const profile = buildObjectiveScheduleProfile(ctx.positions);
    const pos24 = profile.positions24hs;
    const customNames = new Set(profile.positionsCustom.map((p) => p.positionName));
    const emp24 = ctx.employees.filter((emp) => {
        const d = ctx.defaultPositionByEmp?.[emp.id];
        if (d && customNames.has(d)) return false;
        return true;
    });
    console.log('employees total', ctx.employees.length, 'phase24 pool', emp24.length);

    const ctxPhase24 = {
        ...ctx,
        positions: pos24,
        employees: emp24,
        rotateShifts: false,
        demandDriven: false,
        _skipMixedPipeline: true,
    };
    const plan = buildPlanningRunPlan24hs(ctxPhase24);
    console.log('plan', plan ? 'ok structural=' + plan.structuralHeadcount : 'null');
    if (plan) {
        const roster = allocate24hsRotationRoster(ctxPhase24, plan);
        console.log('roster ok', roster.ok, 'floaters', roster.floaters?.length, 'errors', roster.errors);
        if (roster.ok) {
            const rosterCtx = applyPlanningRoster24hsToContext(ctxPhase24, roster);
            const floater = generateFixedBandFloaterSchedule(rosterCtx);
            const bill = floater.assignments.reduce((s, a) => s + (Number(a.hours) || 0), 0);
            console.log('floater+roster billable', bill, 'assignments', floater.assignments.length);
        }
    }
    const { allowedPositionNamesForEmp } = await import('../src/lib/planificacion/positionAssignmentPolicy');
    const customPosNames = new Set(profile.positionsCustom.map((p) => p.positionName));
    const empPhase24 = ctx.employees.filter((emp) => {
        const fromDefault = ctx.defaultPositionByEmp?.[emp.id];
        if (fromDefault && customPosNames.has(fromDefault)) return false;
        const allowed = allowedPositionNamesForEmp(ctx, emp.id);
        if (allowed?.length && allowed.every((n) => customPosNames.has(n))) return false;
        return true;
    });
    console.log('empPhase24 count', empPhase24.length, 'includes sample', empPhase24.some((e) => e.id === sampleEmp));
    const phase24InMixed = generateFixedBandFloaterSchedule({
        ...ctx,
        positions: pos24,
        employees: empPhase24,
        rotateShifts: false,
        demandDriven: false,
        _skipMixedPipeline: true,
    });
    const p24m = phase24InMixed.assignments.find((a) => a.empId === sampleEmp && a.dateStr === sampleDate);
    console.log('phase24 in mixed pool', p24m?.code, p24m?.hours);
    const billPlain = floaterPlain.assignments.reduce((s, a) => s + (Number(a.hours) || 0), 0);
    console.log('floater plain billable', billPlain, 'assignments', floaterPlain.assignments.length);

    const { generateScheduleMixedObjective } = await import('../src/lib/planificacion/mixedScheduleEngine');
    const mixed = generateScheduleMixedObjective(ctx);
    const billMixed = mixed.assignments.reduce((s, a) => s + (Number(a.hours) || 0), 0);
    console.log('mixed merged billable', billMixed, 'n', mixed.assignments.length);
    const p24cell = floaterPlain.assignments.find((a) => a.empId === sampleEmp && a.dateStr === sampleDate);
    const mcell = mixed.assignments.find((a) => a.empId === sampleEmp && a.dateStr === sampleDate);
    console.log('sample phase24', p24cell?.code, p24cell?.hours, p24cell?.positionName);
    console.log('sample merged', mcell?.code, mcell?.hours, mcell?.positionName);

    const v2custom = generateScheduleV2({
        ...ctx,
        positions: profile.positionsCustom,
        rotateShifts: false,
        pinnedAssignments: floaterPlain.assignments.filter((a) => {
            const titulars = new Set(['4JF487GdlTAVryEzUu5y', 'AKGLjWVUk6Lg5YlzbYqq']);
            if (!titulars.has(a.empId)) return true;
            const day = ctx.getDayLetter(a.dateStr);
            return !['L', 'M', 'X', 'J', 'V'].includes(day);
        }),
        defaultPositionByEmp: ctx.defaultPositionByEmp,
        _skipMixedPipeline: true,
    });
    const ccell = v2custom.assignments.find((a) => a.empId === sampleEmp && a.dateStr === sampleDate);
    console.log('sample custom phase', ccell?.code, ccell?.hours, ccell?.positionName);
}

main().catch(console.error);
