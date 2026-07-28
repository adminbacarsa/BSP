/**
 * Smoke Edificio Corporativo: mixto custom L–V + 24hs, excedente + vacaciones.
 * npm run eval:edificio-corporativo
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
    const { positionIsActiveOn, is24hsRotationPosition } = await import('../src/lib/planificacion/autoScheduleEngineV2');
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
        {
            positionName: 'Recepcion 1', qty: 1, coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00', days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        { positionName: 'Recepcion', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
        { positionName: 'Playa', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
        {
            positionName: 'Bunker', qty: 1, coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'M1', name: 'Mañana', hours: 10, startTime: '07:00', endTime: '17:00', days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        {
            positionName: 'Vig. Fisica', qty: 1, coverageType: 'custom',
            activeDays: ['L', 'M', 'X', 'J', 'V'],
            shifts: [{ code: 'MV1', name: 'Mañana', hours: 10, startTime: '07:00', endTime: '17:00', days: ['L', 'M', 'X', 'J', 'V'] }],
        },
        { positionName: 'Control y Vigilancia', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: M_T_N },
    ];

    const employees: V2EmployeeDef[] = Array.from({ length: 16 }, (_, i) => ({
        id: `emp${i}`,
        nombre: `Guardia ${i + 1}`,
        preferredObjectiveId: 'auto-lab-case-real-service',
    }));

    const vacEmpId = 'emp4';

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service', order: 6, title: 'Edificio Corporativo', subtitle: 'x', description: 'x',
        expectations: [], coverageNotes: '', positions, employeeCount: 16,
        cycle: '6+2', rotationMode: 'rotative', slaVendidas: 2876,
        serviceStartDate: '2026-06-01', serviceEndDate: '2026-07-31',
        serviceExcludedDates: [],
        absencesByDate: [
            { empId: vacEmpId, dateStr: '2026-07-24', code: 'V' },
            { empId: vacEmpId, dateStr: '2026-07-25', code: 'V' },
            { empId: vacEmpId, dateStr: '2026-07-26', code: 'V' },
            { empId: vacEmpId, dateStr: '2026-07-27', code: 'V' },
        ],
    };

    let failed = false;
    const assert = (cond: boolean, msg: string) => {
        if (!cond) { console.error(`FAIL: ${msg}`); failed = true; }
        else console.log(`OK: ${msg}`);
    };

    const DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    const getDayLetter = (ds: string) => DAY[new Date(`${ds}T12:00:00`).getDay()];

    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const outcome = generateAutoLabSchedule(caseDef, run);
    const assignments = outcome.generation?.assignments ?? [];
    const stats = outcome.generation?.stats;
    const { verifyAutoLabCoverage } = await import('../src/lib/planificacion/autoLabSchedule');
    const coverageReport = verifyAutoLabCoverage(caseDef, run, outcome);

    const weekdays = run.daysInMonth.map((d) => {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }).filter((ds) => ['L', 'M', 'X', 'J', 'V'].includes(getDayLetter(ds)));

    const rec1Group = stats?.positionGroups?.['Recepcion 1'] ?? [];
    const titularRec1 = rec1Group[0];
    const surplusId = rec1Group.find((id, i) => i >= 1) ?? stats?.idleEmployeeIds?.[0];

    const titularRec1M = assignments.filter((a) =>
        a.empId === titularRec1 && weekdays.includes(a.dateStr)
        && String(a.code).toUpperCase() === 'M' && (Number(a.hours) || 0) > 0,
    );
    const surplusRec1M = surplusId ? assignments.filter((a) =>
        a.empId === surplusId && a.positionName === 'Recepcion 1'
        && weekdays.includes(a.dateStr) && (Number(a.hours) || 0) > 0,
    ) : [];
    const surplusN12 = surplusId ? assignments.filter((a) =>
        a.empId === surplusId && ['N12', 'D12'].includes(String(a.code).toUpperCase()),
    ) : [];

    const pos24 = positions.filter((p) => is24hsRotationPosition(p));
    const weekendDays = run.daysInMonth.map((d) => {
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }).filter((ds) => ['S', 'D'].includes(getDayLetter(ds)));

    const controlGroup = new Set(stats?.positionGroups?.['Control y Vigilancia'] ?? []);
    const controlWeekendBillable = assignments.filter((a) =>
        controlGroup.has(a.empId) && weekendDays.includes(a.dateStr)
        && ['M', 'T', 'N'].includes(String(a.code).toUpperCase()) && (Number(a.hours) || 0) > 0,
    );
    const controlWeekendDemand = buildObjectiveCoverageDemand(
        positions,
        weekendDays.map((dateStr) => ({ dateStr, dayLetter: getDayLetter(dateStr) })),
        ['6+2'],
        (pos, letter) => positionIsActiveOn(pos as V2PositionDef, letter),
    ).reduce((s, d) => {
        const pd = d.positions.find((p) => p.positionName === 'Control y Vigilancia');
        if (!pd) return s;
        return s + Object.values(pd.bandSlots).reduce((a, n) => a + n, 0);
    }, 0);

    const vacDays = ['2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'];
    const recepcionGaps = vacDays.map((ds) => {
        const bands = ['M', 'T', 'N'];
        const missing = bands.filter((b) => !assignments.some((a) =>
            a.dateStr === ds && a.positionName === 'Recepcion'
            && String(a.code).toUpperCase() === b && (Number(a.hours) || 0) > 0,
        ));
        return { ds, missing };
    });

    console.log('=== eval:edificio-corporativo ===');
    console.log('Pipeline:', outcome.pipeline);
    console.log('Uncovered:', stats?.uncoveredSlots);
    console.log('Recepcion 1 titular:', titularRec1, 'M L-V:', titularRec1M.length);
    console.log('Excedente en Recepcion 1 billable:', surplusRec1M.length);
    console.log('Excedente N12/D12:', surplusN12.length, surplusN12.map((a) => `${a.dateStr}:${a.code}@${a.positionName}`).join(', '));
    console.log('Control finde billable:', controlWeekendBillable.length, '/', controlWeekendDemand);
    console.log('Huecos Recepcion vacaciones:', recepcionGaps.filter((g) => g.missing.length > 0).map((g) => `${g.ds}[${g.missing.join(',')}]`).join(' | ') || 'ninguno');

    assert(outcome.pipeline === 'fixedBandFloater', 'pipeline floater');
    assert(titularRec1M.length >= weekdays.length, `PAULI/titular M L-V (${titularRec1M.length}/${weekdays.length})`);
    assert(surplusRec1M.length === 0, `excedente sin turnos en Recepcion 1 (${surplusRec1M.length})`);
    assert(surplusN12.length === 0, `excedente sin N12/D12 (${surplusN12.length})`);
    assert(controlWeekendBillable.length >= controlWeekendDemand * 0.85, `Control 24hs finde (${controlWeekendBillable.length}/${controlWeekendDemand})`);
    assert(recepcionGaps.every((g) => g.missing.length === 0), 'Recepcion cubierta en vacaciones');
    assert((stats?.uncoveredSlots ?? 0) === 0, `grilla huecos SLA (${stats?.uncoveredSlots})`);
    const phantomD12 = coverageReport?.uncovered.filter((u) =>
        ['D12', 'N12'].includes(String(u.shiftCode).toUpperCase()),
    ) ?? [];
    assert((coverageReport?.coverage.uncoveredSlots ?? 0) === 0, `panel huecos (${coverageReport?.coverage.uncoveredSlots})`);
    assert(phantomD12.length === 0, `sin huecos fantasma D12/N12 (${phantomD12.length})`);

    if (failed) { console.error('=== FAIL ==='); process.exit(1); }
    console.log('=== eval:edificio-corporativo PASS ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
