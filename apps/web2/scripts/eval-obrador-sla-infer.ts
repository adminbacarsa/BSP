/**
 * Obrador con puestos M/T/N mal tipados en SLA (sin coverageType 24hs, activeDays L–V).
 * Reproduce el bug Firestore real: F en todo el finde + Huecos SLA 0.
 * Ejecutar: npm run eval:obrador-sla-infer
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';

async function main() {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule } = await import('../src/lib/planificacion/autoLabSchedule');
    const { is24hsRotationPosition, normalize24hsPositionCalendars } = await import('../src/lib/planificacion/autoScheduleEngineV2');
    const { analyzeCoveragePolicyBalance } = await import('../src/lib/planificacion/coveragePolicyBalance');
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const M_T_N: V2PositionDef['shifts'] = [
        { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    ];

    const mislabeled24hs = (name: string, qty: number): V2PositionDef => ({
        positionName: name,
        qty,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: M_T_N,
    });

    const positions: V2PositionDef[] = [
        {
            positionName: 'Puesto Encargada',
            qty: 1,
            coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'EN', name: 'Encargada', hours: 9, days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        {
            positionName: 'Puesto Rondin',
            qty: 1,
            coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'RO', name: 'Rondin', hours: 10, days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        mislabeled24hs('Puesto 3', 1),
        mislabeled24hs('Puesto 1', 2),
        mislabeled24hs('Puesto 2', 1),
    ];

    let failed = false;
    const assert = (cond: boolean, msg: string) => {
        if (!cond) {
            console.error(`FAIL: ${msg}`);
            failed = true;
        } else {
            console.log(`OK: ${msg}`);
        }
    };

    for (const p of ['Puesto 1', 'Puesto 2', 'Puesto 3']) {
        const pos = positions.find((x) => x.positionName === p)!;
        assert(is24hsRotationPosition(pos), `${p} inferido como 24hs M/T/N`);
    }

    const normalized = normalize24hsPositionCalendars(positions);
    for (const p of ['Puesto 1', 'Puesto 2', 'Puesto 3']) {
        const pos = normalized.find((x) => x.positionName === p)!;
        assert(pos.coverageType === '24hs', `${p} normalizado a coverageType 24hs`);
        assert(pos.activeDays?.includes('S') && pos.activeDays?.includes('D'), `${p} opera fin de semana`);
    }

    const ids = [
        '3vJaULtrT3JFIiszQXL5', '6DZuAHkSh7FsDRzwMstd', '8HEF2idU8Av0wMVij09x',
        'ALK4FFNmeCuIK3SsU6GC', 'FLsIn1eBOthVbyu4NO47', 'SiWObGXG2n0MdDbovRpO',
        'SycMPNGGxQQcb2zTh2wJ', 'Ws7IYCcCS3qUnK7Qxr0k', 'aNTaYIxOkDznmlngBQtY',
        'aVqbK64mr2kuqyzax47t', 'hCHGnoSELIQYikH44N45', 'ikgRrbiZQRFlRYRoMqYd',
        'jcOpr1p6CAchg5YhQjhQ', 'kaXJh0oGqUSpcZDQwRv0', 'mlL36UtseWRboFAPfP0q',
        'oZg6B1Tf0KskcrUohqie', 'snOZP7AmOsiKgyqKmRMG', 'vWjayw9liBAsJY6N7ISc',
        'va7koJsMuwem5IBmCUmB',
    ];
    const employees: V2EmployeeDef[] = ids.map((id) => ({
        id,
        nombre: id.slice(0, 6),
        preferredObjectiveId: 'auto-lab-case-real-service',
    }));

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service',
        order: 6,
        title: 'Obrador SLA infer',
        subtitle: 'x',
        description: 'x',
        expectations: [],
        coverageNotes: '',
        positions: normalized,
        employeeCount: 19,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidas: 3413,
        serviceStartDate: '2026-07-01',
        serviceEndDate: '2026-07-31',
        absencesByDate: [],
    };

    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const outcome = generateAutoLabSchedule(caseDef, run);
    const assignments = outcome.generation!.assignments;
    const stats = outcome.generation!.stats;

    const weekend = ['2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12'];
    const pos24 = new Set(['Puesto 1', 'Puesto 2', 'Puesto 3']);

    const billableWeekend = assignments.filter((a) =>
        weekend.includes(a.dateStr)
        && pos24.has(a.positionName)
        && (Number(a.hours) || 0) > 0
        && ['M', 'T', 'N'].includes(String(a.code).toUpperCase()),
    );

    const fWeekend24 = assignments.filter((a) => {
        if (!weekend.includes(a.dateStr)) return false;
        const pg = stats.positionGroups || {};
        const isTitular24 = Object.entries(pg).some(([pn, emps]) =>
            pos24.has(pn) && emps.includes(a.empId),
        );
        return isTitular24 && String(a.code).toUpperCase() === 'F';
    });

    const satGaps = stats.uncoveredSlotsByDay?.['2026-07-04']?.reduce((s, g) => s + g.missing, 0) ?? -1;

    console.log('Billable finde 24hs:', billableWeekend.length);
    console.log('F finde titulares 24hs:', fWeekend24.length);
    console.log('Huecos SLA sáb 04:', satGaps);
    console.log('Huecos total:', stats.uncoveredSlots);

    assert(billableWeekend.length >= 12, `cobertura billable finde (${billableWeekend.length})`);
    assert(fWeekend24.length < 40, `no masivo F en finde titulares 24hs (${fWeekend24.length})`);
    assert(satGaps < 6, `sábado no muestra 0 huecos con cobertura rota (gaps=${satGaps})`);
    assert((stats.uncoveredSlots ?? 99) <= 15, `huecos totales razonables (${stats.uncoveredSlots})`);

    if (failed) {
        console.error('=== eval:obrador-sla-infer FAIL ===');
        process.exit(1);
    }
    console.log('=== eval:obrador-sla-infer PASS ===');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
