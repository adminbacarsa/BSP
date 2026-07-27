/**
 * Smoke: volante en RET cubre hueco custom en objetivo mixto.
 * Ejecutar: npm run eval:volante-custom
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
    const { fillCustomGapsFromVolantes } = await import('../src/lib/planificacion/volanteCustomCoverage');
    const { analyzeCoveragePolicyBalance } = await import('../src/lib/planificacion/coveragePolicyBalance');
    const { buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { generateScheduleV4 } = await import('../src/lib/planificacion/autoScheduleEngineV4');
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const M_T_N: V2PositionDef['shifts'] = [
        { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    ];

    const objectiveId = 'auto-lab-case-real-service';
    const positions: V2PositionDef[] = [
        { positionName: 'Puesto 1', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
        {
            positionName: 'Museo',
            qty: 1,
            coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'MA', name: 'mañana', hours: 9, startTime: '08:00', endTime: '17:00', days: ['L', 'M', 'X', 'J', 'V'] }],
        },
    ];

    const titulars: V2EmployeeDef[] = [
        { id: 't1', nombre: 'Titular 24hs A', preferredObjectiveId: objectiveId },
        { id: 't2', nombre: 'Titular 24hs B', preferredObjectiveId: objectiveId },
        { id: 't3', nombre: 'Titular 24hs C', preferredObjectiveId: objectiveId },
        { id: 't4', nombre: 'Titular Museo', preferredObjectiveId: objectiveId },
    ];
    const volante: V2EmployeeDef = {
        id: 'vol1',
        nombre: 'Volante RET',
        preferredObjectiveId: 'otro-objetivo',
        volante: [objectiveId],
    };
    const employees = [...titulars, volante];

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service',
        order: 6,
        title: 'Mixto volante',
        subtitle: 'x',
        description: 'x',
        expectations: [],
        coverageNotes: '',
        positions,
        employeeCount: employees.length,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidas: 900,
        serviceStartDate: '2026-07-01',
        serviceEndDate: '2026-07-31',
        absencesByDate: [],
    };

    let failed = false;
    const assert = (cond: boolean, msg: string) => {
        if (!cond) {
            console.error(`FAIL: ${msg}`);
            failed = true;
        } else {
            console.log(`OK: ${msg}`);
        }
    };

    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);
    const motor = generateScheduleV4(ctx);

    const gapDay = '2026-07-07';
    const assignments = motor.assignments.map((a) => ({ ...a }));
    const museoTitular = motor.stats.positionGroups?.Museo?.[0];
    assert(!!museoTitular, 'titular Museo asignado');

    const museoCell = assignments.find((a) => a.empId === museoTitular && a.dateStr === gapDay);
    if (museoCell) {
        museoCell.code = 'F';
        museoCell.name = 'Franco';
        museoCell.hours = 0;
        museoCell.positionName = '';
        museoCell.isFranco = true;
    }

    const volanteCell = assignments.find((a) => a.empId === volante.id && a.dateStr === gapDay);
    if (volanteCell) {
        volanteCell.code = 'RET';
        volanteCell.name = 'Retén';
        volanteCell.hours = 0;
        volanteCell.startTime = '00:00';
        volanteCell.positionName = '';
        volanteCell.isFranco = false;
        volanteCell.isReten = true;
    } else {
        assignments.push({
            empId: volante.id,
            dateStr: gapDay,
            positionName: '',
            code: 'RET',
            name: 'Retén',
            hours: 0,
            startTime: '00:00',
            isReten: true,
        });
    }

    const before = analyzeCoveragePolicyBalance(ctx, assignments);
    const customGapBefore = before.underCoverage.filter((g) => g.positionName === 'Museo' && g.dateStr === gapDay);
    assert(customGapBefore.length > 0, 'hueco custom simulado en Museo');

    const filled = fillCustomGapsFromVolantes({
        assignments,
        ctx,
        stats: motor.stats,
    });
    assert(filled.actions.length >= 1, `volante cubre hueco (${filled.actions.length} acciones)`);
    assert(
        filled.actions.some((a) => a.empId === volante.id && a.reason === 'volante_ret'),
        'prioriza volante en RET',
    );

    const cell = filled.assignments.find((a) => a.empId === volante.id && a.dateStr === gapDay);
    assert(cell?.code === 'MA' && cell.positionName === 'Museo', `volante asignado MA@Museo (got ${cell?.code}@${cell?.positionName})`);

    const after = analyzeCoveragePolicyBalance(ctx, filled.assignments);
    const customGapAfter = after.underCoverage.filter((g) => g.positionName === 'Museo' && g.dateStr === gapDay);
    assert(customGapAfter.length === 0, `hueco Museo cerrado (quedan ${customGapAfter.length})`);

    const outcome = generateAutoLabSchedule(caseDef, run);
    assert((outcome.generation?.stats.uncoveredSlots ?? 99) <= 5, `pipeline mixto con volante razonable (${outcome.generation?.stats.uncoveredSlots})`);

    if (failed) {
        console.error('=== eval:volante-custom FAIL ===');
        process.exit(1);
    }
    console.log('=== eval:volante-custom PASS ===');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
