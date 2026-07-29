/**
 * Manzana Histórica — Puesto 1: custom L–D, M 9h, pax 2, 3 guardias (rotación 2+1).
 * Ejecutar: npm run eval:manzana-historica
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
    const {
        buildCustomCycleWorkDays,
        customCoverRequiredHeadcount,
        isBalancedLdNineHourRetTopUpProfile,
        pickBalancedCustomWorkers,
    } = await import('../src/lib/planificacion/customCoverCycle');
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const puesto1: V2PositionDef = {
        positionName: 'Puesto 1',
        qty: 2,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        shifts: [{
            code: 'M',
            name: 'Mañana',
            hours: 9,
            startTime: '08:00',
            endTime: '17:00',
        }],
    };

    const puesto2: V2PositionDef = {
        positionName: 'Puesto 2',
        qty: 1,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V'],
        shifts: [{
            code: 'ME',
            name: 'Mañana',
            hours: 12,
            startTime: '07:30',
            endTime: '19:30',
            days: ['L', 'M', 'X', 'J', 'V'],
        }],
    };

    const employees: V2EmployeeDef[] = [
        { id: 'venenc', nombre: 'VENENC', preferredObjectiveId: 'obj' },
        { id: 'echeva', nombre: 'ECHEVA', preferredObjectiveId: 'obj' },
        { id: 'conte', nombre: 'CONTE', preferredObjectiveId: 'obj' },
        { id: 'g4', nombre: 'G4', preferredObjectiveId: 'obj' },
    ];

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service',
        order: 6,
        title: 'Manzana Historica',
        subtitle: 'Banco de Cordoba',
        description: 'Eval rotación 3 guardias / pax 2 / M 9h L–D',
        expectations: [],
        coverageNotes: '',
        positions: [puesto1, puesto2],
        employeeCount: 4,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidas: 834,
        serviceStartDate: '2026-07-01',
        serviceEndDate: '2026-07-31',
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

    const DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    const getDayLetter = (ds: string) => DAY[new Date(`${ds}T12:00:00`).getDay()];
    const getDateKey = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    assert(customCoverRequiredHeadcount(puesto1) === 3, 'plantilla Puesto 1 = 3 guardias');
    assert(
        isBalancedLdNineHourRetTopUpProfile(puesto1, 3),
        'Puesto 1 califica perfil L–D / 9h / 3 guardias / pax 2',
    );
    assert(
        !isBalancedLdNineHourRetTopUpProfile(puesto2, 1),
        'Puesto 2 L–V 12h NO califica perfil RET top-up',
    );

    for (let absDay = 0; absDay < 31; absDay++) {
        const workers = pickBalancedCustomWorkers(absDay, 3, 2, 6, 7);
        assert(workers.length === 2, `día ${absDay}: exactamente 2 guardias en turno`);
        assert(new Set(workers).size === 2, `día ${absDay}: sin duplicar índice`);
    }

    const groupIds = ['venenc', 'echeva', 'conte'];
    const workSets: Record<string, Set<string>> = {};
    for (const empId of groupIds) {
        workSets[empId] = buildCustomCycleWorkDays({
            empId,
            pos: puesto1,
            daysInMonth: Array.from({ length: 31 }, (_, i) => new Date(2026, 6, i + 1)),
            groupMemberIds: groupIds,
            monthStartGlobalDayIndex: 0,
            getDateKey,
            getDayLetter,
        });
    }
    const patterns = groupIds.map((id) => [...workSets[id]].sort().join(','));
    assert(patterns[0] !== patterns[1], 'VENENC y ECHEVA no comparten patrón');
    assert(patterns[1] !== patterns[2], 'ECHEVA y CONTE no comparten patrón');
    assert(patterns[0] !== patterns[2], 'VENENC y CONTE no comparten patrón');

    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const outcome = generateAutoLabSchedule(caseDef, run);

    assert(!!outcome.generation, 'generación OK');
    assert(outcome.pipeline === 'v4', `pipeline V4 (custom puro): ${outcome.pipeline}`);

    const assignments = outcome.generation!.assignments;
    const stats = outcome.generation!.stats;
    const p1Group = new Set(stats.positionGroups?.['Puesto 1'] ?? groupIds);

    const julyDays = run.daysInMonth.map(getDateKey);

    for (const dateStr of julyDays) {
        const mCount = assignments.filter((a) =>
            a.positionName === 'Puesto 1'
            && a.dateStr === dateStr
            && String(a.code).toUpperCase() === 'M'
            && (Number(a.hours) || 0) > 0,
        ).length;
        assert(mCount === 2, `${dateStr}: Puesto 1 tiene ${mCount}×M (esperado 2)`);
    }

    const workDaysByEmp: Record<string, number> = {};
    for (const id of p1Group) {
        workDaysByEmp[id] = assignments.filter((a) =>
            a.empId === id
            && a.positionName === 'Puesto 1'
            && String(a.code).toUpperCase() === 'M'
            && (Number(a.hours) || 0) > 0,
        ).length;
    }

    const hoursByEmp: Record<string, number> = {};
    for (const id of p1Group) {
        hoursByEmp[id] = stats.employeeMonthlyHours?.[id] ?? 0;
    }

    const retByEmp: Record<string, number> = {};
    for (const id of p1Group) {
        retByEmp[id] = assignments.filter((a) =>
            a.empId === id
            && String(a.code).toUpperCase() === 'RET',
        ).length;
    }

    const retTopUpPositions = stats.balancedLdRetTopUpPositions ?? [];
    assert(retTopUpPositions.includes('Puesto 1'), `RET top-up aplicado en Puesto 1: ${retTopUpPositions.join(', ')}`);

    for (const [id, days] of Object.entries(workDaysByEmp)) {
        assert(days >= 19 && days <= 22, `${id}: ${days} jornadas M (rango 19–22)`);
        assert(hoursByEmp[id] >= 171 && hoursByEmp[id] <= 198, `${id}: ${hoursByEmp[id]} h facturables (rango 171–198)`);
        const retCount = retByEmp[id] ?? 0;
        assert(retCount >= 1 && retCount <= 2, `${id}: ${retCount} RET stand-by (esperado 1–2)`);
        const retCells = assignments.filter((a) =>
            a.empId === id && String(a.code).toUpperCase() === 'RET',
        );
        for (const r of retCells) {
            assert((Number(r.hours) || 0) === 0, `${id} ${r.dateStr}: RET sin horas (stand-by)`);
        }
    }

    const ids = [...p1Group];
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i];
            const b = ids[j];
            const daysA = assignments
                .filter((x) => x.empId === a && x.positionName === 'Puesto 1' && (Number(x.hours) || 0) > 0)
                .map((x) => x.dateStr);
            const daysB = assignments
                .filter((x) => x.empId === b && x.positionName === 'Puesto 1' && (Number(x.hours) || 0) > 0)
                .map((x) => x.dateStr);
            const setA = new Set(daysA);
            const setB = new Set(daysB);
            let same = 0;
            for (const d of setA) if (setB.has(d)) same++;
            assert(same < setA.size, `${a} y ${b}: no patrón idéntico en Puesto 1 (${same}/${setA.size} días iguales)`);
        }
    }

    const totalP1 = Object.values(hoursByEmp).reduce((s, h) => s + h, 0);
    assert(totalP1 === 558, `horas Puesto 1 = ${totalP1} (esperado 558)`);

    console.log('workDaysByEmp', workDaysByEmp);
    console.log('hoursByEmp', hoursByEmp);
    console.log('retByEmp', retByEmp);
    console.log('balancedLdRetTopUpByEmp', stats.balancedLdRetTopUpByEmp);

    if (failed) {
        console.error('\nEVAL Manzana Histórica: FAIL');
        process.exit(1);
    }
    console.log('\nEVAL Manzana Histórica: PASS');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
