/**
 * Caso usuario: 2 puestos 24hs (pax2 + pax1) OK; al agregar custom L–V debe seguir igual.
 * Ejecutar: npm run eval:mixed-custom-floater
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
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const M_T_N: V2PositionDef['shifts'] = [
        { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    ];

    const pos24Only: V2PositionDef[] = [
        { positionName: 'Puesto 2', qty: 2, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
        { positionName: 'Puesto 3', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
    ];

    const posMixed: V2PositionDef[] = [
        {
            positionName: 'Puesto 1',
            qty: 1,
            coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'M', name: 'Mañana', hours: 8, days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        ...pos24Only,
    ];

    const employees: V2EmployeeDef[] = Array.from({ length: 13 }, (_, i) => ({
        id: `G${String(i + 1).padStart(2, '0')}`,
        nombre: `G${String(i + 1).padStart(2, '0')}`,
        preferredObjectiveId: 'obj-mixed',
    }));

    const weekend = ['2026-07-04', '2026-07-05', '2026-07-11', '2026-07-12'];
    const WORK = new Set(['M', 'T', 'N']);

    const runCase = (positions: V2PositionDef[], label: string) => {
        const caseDef: AutoLabCaseDefinition = {
            id: `case-${label}`,
            order: 1,
            title: label,
            subtitle: 'x',
            description: 'x',
            expectations: [],
            coverageNotes: '',
            positions,
            employeeCount: 13,
            cycle: '6+2',
            rotationMode: 'rotative',
            rotateShiftsOverride: false,
            slaVendidas: 2416,
            serviceStartDate: '2026-07-01',
            serviceEndDate: '2026-07-31',
            absencesByDate: [],
        };
        const run = runAutoLabCase(caseDef, 2026, 7, {
            employees,
            objectiveIdForBrain: 'obj-mixed',
        });
        const outcome = generateAutoLabSchedule(caseDef, run);
        return { caseDef, run, outcome };
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

    const pure = runCase(pos24Only, 'pure-24hs');
    assert(pure.outcome.pipeline === 'fixedBandFloater', `solo 24hs usa floater (got ${pure.outcome.pipeline})`);
    const pureStats = pure.outcome.generation!.stats;
    assert((pureStats.uncoveredSlots ?? 99) <= 2, `solo 24hs huecos SLA (${pureStats.uncoveredSlots})`);

    const mixed = runCase(posMixed, 'mixed-custom');
    assert(mixed.outcome.pipeline === 'fixedBandFloater', `mixto usa floater (got ${mixed.outcome.pipeline})`);
    const mixedAssign = mixed.outcome.generation!.assignments;
    const mixedStats = mixed.outcome.generation!.stats;

  const customEmp = 'G01';
    const customSat = mixedAssign.find((a) => a.empId === customEmp && a.dateStr === '2026-07-04');
    assert(String(customSat?.code).toUpperCase() === 'F', `custom ${customEmp} sábado en F (got ${customSat?.code})`);
    const customMon = mixedAssign.find((a) => a.empId === customEmp && a.dateStr === '2026-07-06');
    assert(String(customMon?.code).toUpperCase() === 'M', `custom ${customEmp} lunes en M (got ${customMon?.code})`);

    const pos24 = new Set(['Puesto 2', 'Puesto 3']);
    const billableWeekend = mixedAssign.filter((a) =>
        weekend.includes(a.dateStr)
        && pos24.has(a.positionName)
        && WORK.has(String(a.code).toUpperCase()),
    );
    assert(billableWeekend.length >= 36, `24hs finde cubierto (${billableWeekend.length} turnos)`);
    assert((mixedStats.uncoveredSlots ?? 99) <= 5, `mixto huecos SLA razonables (${mixedStats.uncoveredSlots})`);

    const titulars24 = new Set(
        Object.entries(mixedStats.positionGroups || {})
            .filter(([pn]) => pos24.has(pn))
            .flatMap(([, ids]) => ids),
    );
    let bandBreaks = 0;
    for (const empId of titulars24) {
        const days = mixedAssign
            .filter((a) => a.empId === empId && WORK.has(String(a.code).toUpperCase()))
            .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        let streak = 0;
        let lastBand = '';
        for (const a of days) {
            const b = String(a.code).toUpperCase();
            if (b === lastBand) {
                streak += 1;
                if (streak > 6) bandBreaks += 1;
            } else {
                if (lastBand && streak > 0 && streak < 6) bandBreaks += 1;
                lastBand = b;
                streak = 1;
            }
        }
    }
    assert(bandBreaks < 8, `titulares 24hs sin mezcla errática de bandas (${bandBreaks} cortes)`);

    const fAllWeekendP2 = mixedAssign.filter((a) => {
        if (!weekend.includes(a.dateStr)) return false;
        if (!titulars24.has(a.empId)) return false;
        const pg = mixedStats.positionGroups || {};
        const inP2 = (pg['Puesto 2'] || []).includes(a.empId);
        return inP2 && String(a.code).toUpperCase() === 'F';
    });
    assert(fAllWeekendP2.length < titulars24.size * 2, 'no todos los 24hs en F el finde');

    console.log('Pipeline mixto:', mixed.outcome.pipeline);
    console.log('Huecos SLA mixto:', mixedStats.uncoveredSlots);
    console.log('Billable finde 24hs:', billableWeekend.length);

    if (failed) {
        console.error('=== eval:mixed-custom-floater FAIL ===');
        process.exit(1);
    }
    console.log('=== eval:mixed-custom-floater PASS ===');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
