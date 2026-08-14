process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'eval-app';

async function main(): Promise<void> {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule } = await import('../src/lib/planificacion/autoLabSchedule');
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

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
    const empIds = [
        '4JF487GdlTAVryEzUu5y', 'AKGLjWVUk6Lg5YlzbYqq', 'KwoasCLVnkz9y2h9MnOL', 'Pl4iHKrGu0qE8HSnDd97',
        'Pv2y0buUkBBYI9BqlBGy', 'W2KasDpuYn6F0JJy8p9V', 'Z6phC2rsjfWQNeCMZZBm', 'bFaCl00LNtrEv4Rco5Ae',
        'fBJeRulBMbWda5irotFO', 'huLeYUKs8K6kLpBePH6H', 'jKWkDpRenTqGyAf5ZphP', 'kF45ARSyrLE1c98l8XHr',
        'nzi2QMhJomLfSsAOEhE2', 'pyaGffZq2RyDgysBDbxT', 't1AUNgFVeHMDv9THxaHD', 'usUePceuvfcF8gO12vHw',
        'vY85ieGn9s0Bcdj7g6ya',
    ];
    const caseDef = {
        id: 'x', order: 1, title: 'Obrador', subtitle: '', description: '', expectations: [], coverageNotes: '',
        positions: [
            { positionName: 'Puesto 3', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
            { positionName: 'Puesto 1', qty: 2, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M1 },
            { positionName: 'Puesto 2', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: P2 },
        ],
        employeeCount: 17, cycle: '6+2', rotationMode: 'rotative', slaVendidas: 2976,
        serviceStartDate: '2026-08-01', serviceEndDate: '2026-08-31', absencesByDate: [],
    };
    const run = runAutoLabCase(caseDef as any, 2026, 8, {
        employees: empIds.map((id, i) => ({ id, nombre: `E${i}` })),
    });
    console.log('pre-gen retDesignee', run.rosterSurplus.retDesigneeId, 'idle', run.rosterSurplus.idleEmployeeIds);
    const out = generateAutoLabSchedule(caseDef as any, run);
    const gen = out.generation!;
    const byDay = gen.stats.uncoveredSlotsByDay ?? {};
    let daysWithGaps = 0;
    for (let d = 1; d <= 31; d++) {
        const ds = `2026-08-${String(d).padStart(2, '0')}`;
        const gaps = byDay[ds] ?? [];
        const missing = gaps.reduce((s, g) => s + (g.missing ?? 0), 0);
        if (missing > 0) {
            daysWithGaps++;
            if (daysWithGaps <= 5) console.log(ds, missing, gaps);
        }
    }
    const rodrig = gen.assignments.filter((a) => a.empId === 'Z6phC2rsjfWQNeCMZZBm' && (a.hours || 0) > 0);
    const billM = rodrig.filter((a) => a.code === 'M').length;
    console.log('daysWithGaps', daysWithGaps, 'closure', out.scheduleClosure?.ok, out.scheduleClosure?.messages);
    console.log('RODRIG billable shifts', rodrig.length, 'M count', billM);
    console.log('externalRet', out.externalRetActions?.length ?? 0);
    console.log('retDesignee', out.rosterSurplus?.retDesigneeId);
    console.log('p1 len', gen.stats.positionGroups?.['Puesto 1']?.length);
    console.log('p1 ids', gen.stats.positionGroups?.['Puesto 1']);
}

main().catch(console.error);
