process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'eval-app';

async function main(): Promise<void> {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { generateScheduleMixedObjective } = await import('../src/lib/planificacion/mixedScheduleEngine');
    const { prepare24hsPlanningContext } = await import('../src/lib/planificacion/planningOrchestrator24hs');

    const M = [
        { code: 'M', name: 'M', hours: 8, startTime: '06:00', endTime: '14:00' },
        { code: 'T', name: 'T', hours: 8, startTime: '14:00', endTime: '22:00' },
        { code: 'N', name: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
        { code: 'D12', name: 'D12', hours: 12, startTime: '06:00', endTime: '18:00' },
        { code: 'N12', name: 'N12', hours: 12, startTime: '18:00', endTime: '06:00' },
    ];
    const ids = [
        '4JF487GdlTAVryEzUu5y', 'AKGLjWVUk6Lg5YlzbYqq', 'KwoasCLVnkz9y2h9MnOL', 'Pl4iHKrGu0qE8HSnDd97',
        'Pv2y0buUkBBYI9BqlBGy', 'W2KasDpuYn6F0JJy8p9V', 'Z6phC2rsjfWQNeCMZZBm', 'bFaCl00LNtrEv4Rco5Ae',
        'fBJeRulBMbWda5irotFO', 'huLeYUKs8K6kLpBePH6H', 'jKWkDpRenTqGyAf5ZphP', 'kF45ARSyrLE1c98l8XHr',
        'nzi2QMhJomLfSsAOEhE2', 'pyaGffZq2RyDgysBDbxT', 't1AUNgFVeHMDv9THxaHD', 'usUePceuvfcF8gO12vHw',
        'vY85ieGn9s0Bcdj7g6ya',
    ];
    const employees = ids.map((id, i) => ({ id, nombre: `E${i}`, preferredObjectiveId: 'x' }));
    const positions = [
        { positionName: 'Puesto Encargada', qty: 1, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V'], shifts: [{ code: 'EN', name: 'EN', hours: 9, startTime: '08:00', endTime: '17:00', days: ['V', 'L', 'M', 'X', 'J'] }] },
        { positionName: 'Puesto Rondin', qty: 1, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V'], shifts: [{ code: 'RO', name: 'RO', hours: 10, startTime: '08:00', endTime: '18:00', days: ['V', 'L', 'M', 'X', 'J'] }] },
        { positionName: 'Puesto 3', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M },
        { positionName: 'Puesto 1', qty: 2, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M },
        { positionName: 'Puesto 2', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M },
    ];
    const caseDef = {
        id: 'c', order: 1, title: 't', subtitle: 's', description: 'd', expectations: [], coverageNotes: '',
        positions, employeeCount: 17, cycle: '6+2', rotationMode: 'rotative', slaVendidas: 3375,
        serviceStartDate: '2026-08-01', serviceEndDate: '2026-08-31', absencesByDate: [],
    };
    const run = runAutoLabCase(caseDef as any, 2026, 8, { employees });
    let ctx = buildAutoLabGenContext(caseDef as any, run, run.brain);
    const prepared = prepare24hsPlanningContext(ctx);
    if (prepared.ok) ctx = prepared.ctx;
    const gen = generateScheduleMixedObjective(ctx);
    const bill = (arr: typeof gen.assignments) => arr.reduce((s, a) => s + (Number(a.hours) || 0), 0);

    const profile = (await import('../src/lib/planificacion/objectiveServiceModel')).buildObjectiveScheduleProfile(ctx.positions);
    const pos24 = profile.positions24hs;
    const { canUseFixedBandFloater, generateFixedBandFloaterSchedule } = await import('../src/lib/planificacion/fixedBandFloaterScheduleEngine');
    const emp24 = ctx.employees.filter((e) => !['4JF487GdlTAVryEzUu5y', 'AKGLjWVUk6Lg5YlzbYqq'].includes(e.id));
    const p24 = generateFixedBandFloaterSchedule({
        ...ctx,
        positions: pos24,
        employees: emp24,
        rotateShifts: false,
        demandDriven: false,
    });
    console.log('phase24 only billable', bill(p24.assignments), 'n', p24.assignments.length);
    const baigorMon = gen.assignments.find((a) => a.empId === '4JF487GdlTAVryEzUu5y' && a.dateStr === '2026-08-03');
    console.log('n assignments', gen.assignments.length, 'billable', bill(gen.assignments), 'BAIGOR 3/8', baigorMon);
    const gen2 = generateScheduleMixedObjective(buildAutoLabGenContext(caseDef as any, run, run.brain));
    console.log('without prepare billable', gen2.assignments.reduce((s,a)=>s+(Number(a.hours)||0),0), 'n', gen2.assignments.length);
    console.log('stats billable', gen.stats.totalBillableHours);
}

main().catch(console.error);
