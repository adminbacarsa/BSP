/**
 * E2E: Obrador Malagueño mixto — generateAutoLabSchedule con post-proceso completo.
 * Ejecutar: npm run eval:obrador-postprocess
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'eval-app';

async function main(): Promise<void> {
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
        { code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
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
        {
            positionName: 'Puesto 3',
            qty: 1,
            coverageType: '24hs',
            activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
            shifts: M_T_N,
        },
        {
            positionName: 'Puesto 1',
            qty: 2,
            coverageType: '24hs',
            activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
            shifts: M_T_N,
        },
        {
            positionName: 'Puesto 2',
            qty: 1,
            coverageType: '24hs',
            activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
            shifts: M_T_N,
        },
    ];

    const employeeRows: Array<{ id: string; nombre: string }> = [
        { id: '3vJaULtrT3JFIiszQXL5', nombre: 'LOPEZ, DANIEL ALBERTO' },
        { id: '6DZuAHkSh7FsDRzwMstd', nombre: 'LUCERO ROMERO, MATIAS DAVID' },
        { id: '8HEF2idU8Av0wMVij09x', nombre: 'KASIANCHUK, GUSTAVO FACUNDO' },
        { id: 'ALK4FFNmeCuIK3SsU6GC', nombre: 'BORDINO, SANTIAGO NICOLAS' },
        { id: 'FLsIn1eBOthVbyu4NO47', nombre: 'FRANCO, JORGE RUBEN EDUARDO' },
        { id: 'SiWObGXG2n0MdDbovRpO', nombre: 'RODRIGUEZ GIACOM, MACARENA BELEN' },
        { id: 'SycMPNGGxQQcb2zTh2wJ', nombre: 'HERRANTE, FERNANDO JAVIER' },
        { id: 'Ws7IYCcCS3qUnK7Qxr0k', nombre: 'BAIGORRIA, EMMANUEL ERNESTO' },
        { id: 'aNTaYIxOkDznmlngBQtY', nombre: 'PALACIOS, ALEX LEONEL' },
        { id: 'aVqbK64mr2kuqyzax47t', nombre: 'GOYOCHEA, VALERIA YAMILE' },
        { id: 'hCHGnoSELIQYikH44N45', nombre: 'VIDELA, CRISTIAN NICOLAS' },
        { id: 'ikgRrbiZQRFlRYRoMqYd', nombre: 'DIAZ, WALTER OMAR' },
        { id: 'jcOpr1p6CAchg5YhQjhQ', nombre: 'MARTINEZ, WALTER DOMINGO' },
        { id: 'kaXJh0oGqUSpcZDQwRv0', nombre: 'CORONEL, DANIEL ALEXIS' },
        { id: 'mlL36UtseWRboFAPfP0q', nombre: 'ARAYA, SANTIAGO EMANUEL' },
        { id: 'oZg6B1Tf0KskcrUohqie', nombre: 'HERRERA, ERICO VALENTIN' },
        { id: 'snOZP7AmOsiKgyqKmRMG', nombre: 'MORALES, GASTON EZEQUIEL' },
        { id: 'vWjayw9liBAsJY6N7ISc', nombre: 'BARRIOS CARRANZA, ERICK' },
        { id: 'va7koJsMuwem5IBmCUmB', nombre: 'ROMERO, ROMINA PAOLA' },
    ];

    const employees: V2EmployeeDef[] = employeeRows.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        preferredObjectiveId: 'auto-lab-case-real-service',
    }));

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service',
        order: 6,
        title: 'Obrador Malagueño',
        subtitle: 'CASISA · SLA real',
        description: 'Smoke mixto custom+24hs post-proceso',
        expectations: [],
        coverageNotes: '',
        positions,
        employeeCount: employees.length,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidas: 3413,
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
    const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    const getDayLetter = (dateStr: string) => DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];
    const weekendDays = run.daysInMonth
        .map((d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        })
        .filter((ds) => ['S', 'D'].includes(getDayLetter(ds)));

    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);
    const outcome = generateAutoLabSchedule(caseDef, run);

    console.log('=== eval:obrador-postprocess ===');
    console.log('pipeline:', outcome.pipeline);
    console.log('error:', outcome.error ?? '(none)');

    assert(outcome.pipeline === 'fixedBandFloater', `pipeline floater mixto (got ${outcome.pipeline})`);
    assert(!outcome.error, `sin error (${outcome.error ?? ''})`);
    assert(!!outcome.generation, 'generación presente');

    const gen = outcome.generation!;
    const assignments = gen.assignments;
    const stats = gen.stats;

    const pos24 = new Set(['Puesto 1', 'Puesto 2', 'Puesto 3']);
    const billableWeekend = assignments.filter((a) => {
        if (!weekendDays.includes(a.dateStr)) return false;
        if (!pos24.has(a.positionName)) return false;
        return (Number(a.hours) || 0) > 0 && ['M', 'T', 'N', 'D12', 'N12'].includes(String(a.code).toUpperCase());
    });

    const weekendDemand = buildObjectiveCoverageDemand(
        positions,
        weekendDays.map((dateStr) => ({ dateStr, dayLetter: getDayLetter(dateStr) })),
        ['6+2'],
        (pos, letter) => positionIsActiveOn(pos as V2PositionDef, letter),
    );
    const weekendSlotsRequired = weekendDemand.reduce(
        (s, d) => s + Object.values(d.totalBandSlots).reduce((a, n) => a + n, 0),
        0,
    );

    const empPosMap = stats.employeePositionMap ?? {};
    const pos24Emps = new Set(
        Object.entries(empPosMap)
            .filter(([, pn]) => pos24.has(pn))
            .map(([id]) => id),
    );

    const fOnWeekend24hs = assignments.filter((a) => {
        if (!weekendDays.includes(a.dateStr)) return false;
        if (!pos24Emps.has(a.empId)) return false;
        return String(a.code).toUpperCase() === 'F' && (Number(a.hours) || 0) === 0;
    });

    const workOnWeekend24hs = assignments.filter((a) => {
        if (!weekendDays.includes(a.dateStr)) return false;
        if (!pos24Emps.has(a.empId)) return false;
        return (Number(a.hours) || 0) > 0;
    });

    console.log('Hs facturables:', Math.round(stats.totalBillableHours));
    console.log('Huecos SLA motor:', stats.uncoveredSlots);
    console.log('Slots 24hs fin de semana requeridos:', weekendSlotsRequired);
    console.log('Asignaciones billables 24hs fin de semana:', billableWeekend.length);
    console.log('F en finde (empleados 24hs titulares):', fOnWeekend24hs.length);
    console.log('Turnos en finde (empleados 24hs titulares):', workOnWeekend24hs.length);

    assert(billableWeekend.length > 0, '24hs trabaja fines de semana');
    assert(
        billableWeekend.length >= weekendSlotsRequired * 0.85,
        `cobertura weekend >=85% (${billableWeekend.length} vs ${weekendSlotsRequired})`,
    );
    assert(
        (stats.uncoveredSlots ?? 0) <= 15,
        `huecos balance post-proceso razonables (got ${stats.uncoveredSlots})`,
    );

    const p1WeekendM = assignments.filter(
        (a) => a.positionName === 'Puesto 1' && weekendDays.includes(a.dateStr) && String(a.code).toUpperCase() === 'M',
    );
    assert(p1WeekendM.length >= 2, `Puesto 1 pax=2 tiene M en finde (${p1WeekendM.length})`);

    const gapsByPos: Record<string, number> = {};
    const gapsByDay = stats.uncoveredSlotsByDay ?? {};
    for (const arr of Object.values(gapsByDay)) {
        for (const g of arr) {
            gapsByPos[g.positionName] = (gapsByPos[g.positionName] ?? 0) + g.missing;
        }
    }
    console.log('Huecos por puesto:', gapsByPos);

    const p3Titulars = stats.positionGroups?.['Puesto 3'] ?? [];
    const p3WeekendWork = assignments.filter(
        (a) => p3Titulars.includes(a.empId) && weekendDays.includes(a.dateStr) && (Number(a.hours) || 0) > 0,
    );
    assert(p3WeekendWork.length > 0, `Puesto 3 titulares trabajan fin de semana (${p3WeekendWork.length} turnos)`);

    if (failed) {
        console.error('=== eval:obrador-postprocess FAIL ===');
        process.exit(1);
    }
    console.log('=== eval:obrador-postprocess PASS ===');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
