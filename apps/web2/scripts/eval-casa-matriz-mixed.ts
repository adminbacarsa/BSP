/**
 * Smoke Casa Matriz mixto: 24hs primero + custom L–V.
 * Ejecutar: npm run eval:casa-matriz-mixed
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';

async function main() {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule, buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { generateScheduleV4 } = await import('../src/lib/planificacion/autoScheduleEngineV4');
    const { positionIsActiveOn } = await import('../src/lib/planificacion/autoScheduleEngineV2');
    const { buildObjectiveCoverageDemand } = await import('../src/lib/planificacion/objectiveCoverageDemand');
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const M_T_N: V2PositionDef['shifts'] = [
        { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    ];

    const positions: V2PositionDef[] = [
        { positionName: 'Puesto 1', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
        {
            positionName: 'Museo', qty: 4, coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'MA', name: 'mañana', hours: 9, startTime: '08:00', endTime: '17:00', days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        {
            positionName: 'DIRECTORIO', qty: 2, coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'ME', name: 'm ex', hours: 12, startTime: '08:00', endTime: '20:00', days: ['L', 'M', 'X', 'J', 'V'] }],
        },
    ];

    const employees: V2EmployeeDef[] = Array.from({ length: 10 }, (_, i) => ({
        id: `emp${i}`,
        nombre: `Guardia ${i + 1}`,
        preferredObjectiveId: 'auto-lab-case-real-service',
    }));

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service', order: 6, title: 'Casa Matriz', subtitle: 'x', description: 'x',
        expectations: [], coverageNotes: '', positions, employeeCount: 10,
        cycle: '6+2', rotationMode: 'rotative', slaVendidas: 2040,
        serviceStartDate: '2026-07-01', serviceEndDate: '2026-07-31',
        serviceExcludedDates: ['2026-07-23'], absencesByDate: [],
    };

    let failed = false;
    const assert = (cond: boolean, msg: string) => {
        if (!cond) { console.error(`FAIL: ${msg}`); failed = true; }
        else console.log(`OK: ${msg}`);
    };

    const DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    const getDayLetter = (ds: string) => DAY[new Date(`${ds}T12:00:00`).getDay()];

    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);
    const engine = generateScheduleV4(ctx);
    const outcome = generateAutoLabSchedule(caseDef, run);

    const weekendDays = run.daysInMonth.map((d) => {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }).filter((ds) => ['S', 'D'].includes(getDayLetter(ds)));

    const p1Group = new Set(engine.stats.positionGroups?.['Puesto 1'] ?? []);

    const p1WeekendF = engine.assignments.filter((a) =>
        p1Group.has(a.empId) && weekendDays.includes(a.dateStr) && String(a.code).toUpperCase() === 'F',
    );
    const p1WeekendWork = engine.assignments.filter((a) =>
        p1Group.has(a.empId) && weekendDays.includes(a.dateStr) && (Number(a.hours) || 0) > 0,
    );

    const weekendDemand = buildObjectiveCoverageDemand(
        positions,
        weekendDays.map((dateStr) => ({ dateStr, dayLetter: getDayLetter(dateStr) })),
        ['6+2'],
        (pos, letter) => positionIsActiveOn(pos as V2PositionDef, letter),
    );
    const p1WeekendSlots = weekendDemand.reduce((s, d) => {
        const pd = d.positions.find((p) => p.positionName === 'Puesto 1');
        if (!pd) return s;
        return s + Object.values(pd.bandSlots).reduce((a, n) => a + n, 0);
    }, 0);

    const p1BillableWeekend = engine.assignments.filter((a) =>
        a.positionName === 'Puesto 1' && weekendDays.includes(a.dateStr)
        && (Number(a.hours) || 0) > 0 && ['M', 'T', 'N'].includes(String(a.code).toUpperCase()),
    );

    const weekdays = run.daysInMonth.map((d) => {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }).filter((ds) => ['L', 'M', 'X', 'J', 'V'].includes(getDayLetter(ds)) && ds !== '2026-07-23');

    const finalAssignments = outcome.generation?.assignments ?? [];
    const finalStats = outcome.generation?.stats;
    const museoGroup = new Set(finalStats?.positionGroups?.['Museo'] ?? []);
    const directorioGroup = new Set(finalStats?.positionGroups?.['DIRECTORIO'] ?? []);

    const museoMA = finalAssignments.filter((a) =>
        museoGroup.has(a.empId) && weekdays.includes(a.dateStr)
        && String(a.code).toUpperCase() === 'MA' && (Number(a.hours) || 0) > 0,
    );
    const directorioME = finalAssignments.filter((a) =>
        directorioGroup.has(a.empId) && weekdays.includes(a.dateStr)
        && String(a.code).toUpperCase() === 'ME' && (Number(a.hours) || 0) > 0,
    );

    const expectedMuseoCells = museoGroup.size * weekdays.length;
    const expectedDirectorioCells = directorioGroup.size * weekdays.length;

    const emp0Engine = weekendDays.map((ds) => {
        const a = engine.assignments.find((x) => x.empId === 'emp0' && x.dateStr === ds);
        return `${ds}:${a?.code ?? '-'}@${a?.positionName ?? ''}`;
    });
    const emp0Final = weekendDays.map((ds) => {
        const a = outcome.generation?.assignments.find((x) => x.empId === 'emp0' && x.dateStr === ds);
        return `${ds}:${a?.code ?? '-'}@${a?.positionName ?? ''}`;
    });
    console.log('emp0 motor finde:', emp0Engine.join(' | '));
    console.log('emp0 final finde:', emp0Final.join(' | '));

    console.log('=== eval:casa-matriz-mixed ===');
    console.log('Pipeline:', outcome.pipeline);
    console.log('Motor uncovered:', engine.stats.uncoveredSlots);
    console.log('Post uncovered:', outcome.generation?.stats.uncoveredSlots);
    console.log('Idle post:', finalStats?.idleEmployeeIds?.length ?? 0, finalStats?.idleEmployeeIds?.join(', ') ?? '');
    console.log('Museo MA:', museoMA.length, '/', expectedMuseoCells);
    console.log('DIRECTORIO ME:', directorioME.length, '/', expectedDirectorioCells);
    console.log('Puesto 1 grupo:', [...p1Group].join(', '));
    console.log('F finde P1 titulares (motor):', p1WeekendF.length);
    console.log('Turnos finde P1 titulares (motor):', p1WeekendWork.length);
    console.log('Billable P1 finde:', p1BillableWeekend.length, '/ slots', p1WeekendSlots);

    // No todos los titulares 24hs deben tener F en TODOS los fines de semana
    const fByEmpWeekend = new Map<string, number>();
    for (const a of p1WeekendF) {
        fByEmpWeekend.set(a.empId, (fByEmpWeekend.get(a.empId) ?? 0) + 1);
    }
    const allWeekendF = [...p1Group].filter((id) => (fByEmpWeekend.get(id) ?? 0) >= weekendDays.length);
    console.log('Titulares con F en TODOS los findes:', allWeekendF.length, allWeekendF.join(', '));

    assert(p1BillableWeekend.length > 0, 'Puesto 1 24hs trabaja fines de semana');
    assert(allWeekendF.length < p1Group.size, 'no todos los titulares 24hs tienen F en todos los findes');
    assert(p1BillableWeekend.length >= p1WeekendSlots * 0.5, `cobertura P1 finde razonable (${p1BillableWeekend.length}/${p1WeekendSlots})`);
    assert(outcome.pipeline === 'fixedBandFloater', 'pipeline fixedBandFloater');
    assert((finalStats?.idleEmployeeIds?.length ?? 0) === 0, 'sin falsos excedentes (custom titulares)');
    assert(museoMA.length >= expectedMuseoCells, `Museo MA L-V (${museoMA.length}/${expectedMuseoCells})`);
    assert(directorioME.length >= expectedDirectorioCells, `DIRECTORIO ME L-V (${directorioME.length}/${expectedDirectorioCells})`);

    if (failed) { console.error('=== FAIL ==='); process.exit(1); }
    console.log('=== eval:casa-matriz-mixed PASS ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
