/**
 * Test cobertura por puesto/día — escenario 3 puestos mixtos.
 * Ejecutar: npx tsx scripts/test-position-coverage.ts  (desde apps/web2)
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'eval-app';

const DAY = 'L';
const CYCLES = ['6+2'];

const POSITIONS = [
    {
        positionName: 'Puesto 24hs',
        qty: 1,
        coverageType: '24hs',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: [
            { code: 'M', hours: 8 },
            { code: 'T', hours: 8 },
            { code: 'N', hours: 8 },
            { code: 'D12', hours: 12 },
            { code: 'N12', hours: 12 },
        ],
    },
    {
        positionName: 'Puesto 16hs',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [
            { code: 'M', hours: 8 },
            { code: 'T', hours: 8 },
        ],
    },
    {
        positionName: 'Encargada EN',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{ code: 'EN', hours: 10 }],
    },
];

type Scenario = {
    name: string;
    counts: Record<string, Record<string, number>>;
    expectClosed: number;
    expectRequired: number;
    expectByPos: Record<string, { closed: number; required: number }>;
};

const scenarios: Scenario[] = [
    {
        name: 'Todo completo',
        counts: {
            'Puesto 24hs': { M: 1, T: 1, N: 1 },
            'Puesto 16hs': { M: 1, T: 1 },
            'Encargada EN': { EN: 1 },
        },
        expectClosed: 3,
        expectRequired: 3,
        expectByPos: {
            'Puesto 24hs': { closed: 1, required: 1 },
            'Puesto 16hs': { closed: 1, required: 1 },
            'Encargada EN': { closed: 1, required: 1 },
        },
    },
    {
        name: '24hs sin N',
        counts: {
            'Puesto 24hs': { M: 1, T: 1 },
            'Puesto 16hs': { M: 1, T: 1 },
            'Encargada EN': { EN: 1 },
        },
        expectClosed: 2,
        expectRequired: 3,
        expectByPos: {
            'Puesto 24hs': { closed: 0, required: 1 },
            'Puesto 16hs': { closed: 1, required: 1 },
            'Encargada EN': { closed: 1, required: 1 },
        },
    },
    {
        name: '16hs con 2M sin T (16h pero esquema incompleto)',
        counts: {
            'Puesto 24hs': { M: 1, T: 1, N: 1 },
            'Puesto 16hs': { M: 2 },
            'Encargada EN': { EN: 1 },
        },
        expectClosed: 2,
        expectRequired: 3,
        expectByPos: {
            'Puesto 24hs': { closed: 1, required: 1 },
            'Puesto 16hs': { closed: 0, required: 1 },
            'Encargada EN': { closed: 1, required: 1 },
        },
    },
    {
        name: 'Band mezclada entre puestos (M del 24hs no cierra 16hs)',
        counts: {
            'Puesto 24hs': { M: 1, T: 1, N: 1 },
            'Puesto 16hs': { M: 0, T: 0 },
            'Encargada EN': { EN: 0 },
        },
        expectClosed: 1,
        expectRequired: 3,
        expectByPos: {
            'Puesto 24hs': { closed: 1, required: 1 },
            'Puesto 16hs': { closed: 0, required: 1 },
            'Encargada EN': { closed: 0, required: 1 },
        },
    },
    {
        name: '24hs vía D12+N12 contingencia',
        counts: {
            'Puesto 24hs': { D12: 1, N12: 1 },
            'Puesto 16hs': { M: 1, T: 1 },
            'Encargada EN': { EN: 1 },
        },
        expectClosed: 3,
        expectRequired: 3,
        expectByPos: {
            'Puesto 24hs': { closed: 1, required: 1 },
            'Puesto 16hs': { closed: 1, required: 1 },
            'Encargada EN': { closed: 1, required: 1 },
        },
    },
];

async function main(): Promise<void> {
    const {
        countPositionClosedUnitsFromShifts,
        sumDayCoverageFromCodeCounts,
    } = await import('../src/lib/planificacion/positionCoverageUnits');

    let failed = 0;
    console.log('=== Test cobertura 3 puestos (24hs + M+T + EN) ===\n');

    for (const sc of scenarios) {
        const total = sumDayCoverageFromCodeCounts(POSITIONS, DAY, sc.counts, CYCLES);
        const okTotal = total.closed === sc.expectClosed && total.required === sc.expectRequired;
        let okPos = true;
        for (const [posName, exp] of Object.entries(sc.expectByPos)) {
            const got = total.positions.find(p => p.positionName === posName);
            if (!got || got.closed !== exp.closed || got.required !== exp.required) okPos = false;
        }
        const ok = okTotal && okPos;
        if (!ok) failed++;
        console.log(`${ok ? '✓' : '✗'} ${sc.name}`);
        console.log(`   Pie: ${total.closed}/${total.required} (esp: ${sc.expectClosed}/${sc.expectRequired})`);
        for (const p of total.positions) {
            const exp = sc.expectByPos[p.positionName];
            const mark = exp && p.closed === exp.closed ? ' ' : '!';
            console.log(`  ${mark} ${p.positionName}: ${p.closed}/${p.required} [${p.schemeLabel}]`);
        }
        console.log('');
    }

    const u24 = countPositionClosedUnitsFromShifts(POSITIONS[0], DAY, { M: 1, T: 1, N: 0 }, CYCLES);
    console.log('Detalle 24hs M+T sin N:', `${u24.closed}/${u24.required} (${u24.schemeLabel})`);

    const u16 = countPositionClosedUnitsFromShifts(POSITIONS[1], DAY, { M: 2, T: 0 }, CYCLES);
    console.log('Detalle 16hs 2M 0T:', `${u16.closed}/${u16.required} (${u16.schemeLabel})`);

    const pos24x2 = { ...POSITIONS[0], qty: 2 };
    const uMix = countPositionClosedUnitsFromShifts(
        pos24x2,
        DAY,
        { M: 1, T: 1, N: 1, D12: 1, N12: 1 },
        CYCLES,
    );
    const mixOk = uMix.closed === 2 && uMix.required === 2;
    if (!mixOk) failed++;
    console.log(`${mixOk ? '✓' : '✗'} 24hs qty=2 M+T+N + D12+N12: ${uMix.closed}/${uMix.required}`);

    if (failed > 0) {
        console.error(`\n${failed} escenario(s) fallaron`);
        process.exit(1);
    }
    console.log('\nTodos los escenarios OK.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
