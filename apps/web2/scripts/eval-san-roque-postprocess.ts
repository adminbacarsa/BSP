/**
 * E2E: H. San Roque — generateAutoLabSchedule con post-proceso completo.
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'eval-dummy-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eval-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'eval-app';

async function main(): Promise<void> {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule } = await import('../src/lib/planificacion/autoLabSchedule');
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
        'Puesto Rondin',
        'Puesto Playa',
        'Puesto Hall Central',
        'Puesto Salud Mnetal',
    ].map((name) => ({
        positionName: name,
        qty: 1,
        coverageType: '24hs' as const,
        shifts: M_T_N,
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    }));

    const employeeRows: Array<{ id: string; nombre: string }> = [
        { id: '0KozY27p1igVpCEi3dYI', nombre: 'CABRAL CARRION, EVER LEONEL' },
        { id: '1CQAtbfRTj9VOZhki3Xf', nombre: 'DIAZ, EZEQUIEL ALEJANDRO' },
        { id: '2h1CYgDiuInpBx0cPglf', nombre: 'BAZAN, CINTIA SOLEDAD' },
        { id: '7M4nUy7XDhsfxHB3g7Hz', nombre: 'FARIAS, NICOLAS DANTE' },
        { id: 'B4dLwkFxERlo3Zxvxbi9', nombre: 'HERRERA, HERNAN GABRIEL' },
        { id: 'EUOkq4RVYfsY5ZAZ1OUq', nombre: 'VALDEZ, DAMIAN ALBERTO' },
        { id: 'MdAhlJ6ACqnBa25dEoRh', nombre: 'LOPEZ, HECTOR JUAN' },
        { id: 'RVD9nTqF5c4mrfMhDxow', nombre: 'ARAMAYO, YAMIL LAUREANO DAVID' },
        { id: 'U2krcGQjvKc6F6ZQC89A', nombre: 'OLIVEDA, FABIAN ALEJANDRO' },
        { id: 'Z4IyHVJfjBfn0HY3Zg3L', nombre: 'GUZMAN, GUSTAVO ARIEL' },
        { id: 'Z9w2MhRdifBl8U82nomq', nombre: 'MONTERO, ENZO GABRIEL' },
        { id: 'cBmM3olST7Pa5MgsUMIr', nombre: 'TORRES, RICARDO RUBEN' },
        { id: 'cwo2Fizijo9ao6slIb64', nombre: 'SOLIS, GUADALUPE ANDREA' },
        { id: 'kGTOnyRcEaT6j2HRciA3', nombre: 'SCHOOP, JORGELINA NAYLA IVON' },
        { id: 'kUqKPpQiwmdLiWc9A5Gn', nombre: 'ACOSTA, JULIO' },
        { id: 'lphLITYtzSGrRSxrjh7F', nombre: 'ALONSO, MARCIO RUBEN' },
        { id: 'nrrs1aBu7cdAZPY00KXp', nombre: 'ZIEGE PIO, LEONARDO ARTURO' },
        { id: 'nwNgdtwbkzNQPBC5yg1o', nombre: 'ROMERO, JOEL' },
        { id: 'nykgmzvH0qBHDbPpCuqM', nombre: 'MENDEZ, NORMAN GABRIEL' },
    ];

    const employees: V2EmployeeDef[] = employeeRows.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        preferredObjectiveId: 'auto-lab-case-real-service',
    }));

    const absencesByDate = [
        ...Array.from({ length: 7 }, (_, i) => ({
            empId: 'MdAhlJ6ACqnBa25dEoRh',
            dateStr: `2026-07-${String(12 + i).padStart(2, '0')}`,
            code: 'V',
        })),
        ...Array.from({ length: 14 }, (_, i) => ({
            empId: '7M4nUy7XDhsfxHB3g7Hz',
            dateStr: `2026-07-${String(8 + i).padStart(2, '0')}`,
            code: 'V',
        })),
    ];

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service',
        order: 6,
        title: 'H. San Roque Nuevo',
        subtitle: 'MINISTERIO DE SALUD · SLA real',
        description: 'Smoke post-proceso excedente',
        expectations: [],
        coverageNotes: '',
        positions,
        employeeCount: employees.length,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidas: 2976,
        serviceStartDate: '2026-07-01',
        serviceEndDate: '2026-07-31',
        absencesByDate,
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
    const outcome = generateAutoLabSchedule(caseDef, run);

    assert(outcome.pipeline === 'fixedBandFloater', `pipeline floater (got ${outcome.pipeline})`);
    assert(!outcome.error, `sin error (${outcome.error ?? ''})`);
    assert(!!outcome.generation, 'generación presente');

    const gen = outcome.generation!;
    const assignments = gen.assignments;
    const stats = gen.stats;

    const surplusPool = stats.idleEmployeeIds ?? [];
    assert(surplusPool.length === 3, `3 excedentes (got ${surplusPool.length}: ${surplusPool.join(', ')})`);
    assert(
        !surplusPool.includes('7M4nUy7XDhsfxHB3g7Hz'),
        'FARIAS no debe estar en pool excedente',
    );
    assert(
        (stats.idleEmployeeIds ?? []).length === 3,
        `idleEmployeeIds en stats (${(stats.idleEmployeeIds ?? []).join(', ')})`,
    );

    const surplusSet = new Set(surplusPool);
    const titularD12N12 = assignments.filter((a) => {
        if (surplusSet.has(a.empId)) return false;
        const code = String(a.code || '').toUpperCase();
        return code === 'D12' || code === 'N12';
    });
    assert(
        titularD12N12.length === 0,
        `titulares sin D12/N12 con excedente (got ${titularD12N12.length}, ej. ${titularD12N12.slice(0, 3).map((a) => `${a.empId}@${a.dateStr}=${a.code}`).join('; ')})`,
    );

    const surplusBillable = assignments.filter((a) => {
        if (!surplusSet.has(a.empId)) return false;
        const code = String(a.code || '').toUpperCase();
        return ['M', 'T', 'N', 'D12', 'N12'].includes(code);
    });
    const allowedKeys = new Set(
        (outcome.surplusSubstitutionActions ?? []).map((a) => `${a.surplusEmpId}__${a.dateStr}`),
    );
    const illegalSurplusBillable = surplusBillable.filter(
        (a) => !allowedKeys.has(`${a.empId}__${a.dateStr}`),
    );
    assert(
        illegalSurplusBillable.length === 0,
        `excedente sin turnos facturables fuera de sustitución (got ${illegalSurplusBillable.length}, ej. ${illegalSurplusBillable.slice(0, 3).map((a) => `${a.empId.slice(0, 6)}@${a.dateStr}=${a.code}@${a.positionName}`).join('; ')})`,
    );

    const balance = outcome.coveragePolicyBalance;
    assert(!!balance, 'reporte política de cobertura presente');

    const externalRet = assignments.filter((a) => a.empId.startsWith('lab-ret-ext'));
    assert(
        externalRet.length === 0 || balance!.underSlotCount === 0,
        `RET externo solo si excedente agotado (externos=${externalRet.length}, huecos=${balance!.underSlotCount})`,
    );
    if (externalRet.length > 0) {
        console.log(`OK: RET externo residual (${externalRet.length} celdas) tras agotar pool excedente`);
    }

    const dateKeys = run.daysInMonth.map((d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    });
    const cellKeys = new Set(assignments.map((a) => `${a.empId}__${a.dateStr}`));
    let missingCells = 0;
    let duplicateCells = 0;
    const seen = new Set<string>();
    for (const a of assignments) {
        const k = `${a.empId}__${a.dateStr}`;
        if (seen.has(k)) duplicateCells += 1;
        seen.add(k);
    }
    for (const emp of employees) {
        const isSurplus = surplusSet.has(emp.id);
        for (const dateStr of dateKeys) {
            if (!cellKeys.has(`${emp.id}__${dateStr}`)) {
                if (isSurplus) continue;
                missingCells += 1;
            }
        }
    }
    assert(missingCells === 0, `sin celdas vacías (faltan ${missingCells})`);
    assert(duplicateCells === 0, `sin celdas duplicadas (got ${duplicateCells})`);

    const billableHours = assignments.reduce((sum, a) => {
        const h = Number(a.hours) || 0;
        return sum + (h > 0 ? h : 0);
    }, 0);
    assert(
        billableHours <= 3100 && billableHours >= 2800,
        `horas facturables razonables vs SLA 2976 (got ${billableHours})`,
    );
    assert(
        gen.stats.totalBillableHours === billableHours,
        `stats.totalBillableHours alineado con assignments (${gen.stats.totalBillableHours} vs ${billableHours})`,
    );

    assert(
        balance!.overSlotCount === 0,
        `sin sobrecobertura día×puesto×banda (got ${balance!.overSlotCount}, ej. ${balance!.overCoverage.slice(0, 2).map((o) => `${o.dateStr} ${o.positionName} ${o.shiftCode} ${o.qtyAssigned}/${o.qtyRequired}`).join('; ')})`,
    );
    assert(
        balance!.underSlotCount === 0,
        `sin huecos SLA por banda (got ${balance!.underSlotCount}, ej. ${balance!.underCoverage.slice(0, 2).map((u) => `${u.dateStr} ${u.positionName} ${u.shiftCode} ${u.qtyAssigned}/${u.qtyRequired}`).join('; ')})`,
    );

    const FARIAS = '7M4nUy7XDhsfxHB3g7Hz';
    const fariasPreVac = assignments.filter(
        (a) => a.empId === FARIAS && a.dateStr >= '2026-07-01' && a.dateStr <= '2026-07-07',
    );
    const fariasBadPreVac = fariasPreVac.filter((a) => {
        const c = String(a.code || '').toUpperCase();
        return c === 'RET' || c === 'V';
    });
    assert(
        fariasBadPreVac.length === 0,
        `FARIAS M/T/N antes de vacaciones (got ${fariasPreVac.map((a) => `${a.dateStr.slice(8)}:${a.code}`).join(' ')})`,
    );

    const fariasPostVac = assignments.filter(
        (a) => a.empId === FARIAS && a.dateStr >= '2026-07-22' && a.dateStr <= '2026-07-26',
    );
    const fariasWorkPostVac = fariasPostVac.filter((a) => ['M', 'T', 'N'].includes(String(a.code || '').toUpperCase()));
    assert(
        fariasWorkPostVac.length >= 3,
        `FARIAS retoma rotación tras vacaciones 22-26 (got ${fariasPostVac.map((a) => `${a.dateStr.slice(8)}:${a.code}`).join(' ')})`,
    );

    const hallExt = assignments.filter(
        (a) => a.empId.startsWith('lab-ret-ext') && a.positionName === 'Puesto Hall Central',
    );
    assert(
        hallExt.length === 0,
        `Hall Central sin RET externo (got ${hallExt.map((a) => `${a.dateStr}:${a.code}`).join(', ')})`,
    );

    console.log(`OK: política cobertura — ${balance!.summary}`);

    const defaultPositionByEmp: Record<string, string> = {
        '2h1CYgDiuInpBx0cPglf': 'Puesto Rondin',
        'U2krcGQjvKc6F6ZQC89A': 'Puesto Rondin',
        'cBmM3olST7Pa5MgsUMIr': 'Puesto Rondin',
        'cwo2Fizijo9ao6slIb64': 'Puesto Rondin',
        '7M4nUy7XDhsfxHB3g7Hz': 'Puesto Rondin',
        '1CQAtbfRTj9VOZhki3Xf': 'Puesto Playa',
        'Z9w2MhRdifBl8U82nomq': 'Puesto Playa',
        'lphLITYtzSGrRSxrjh7F': 'Puesto Playa',
        'nrrs1aBu7cdAZPY00KXp': 'Puesto Playa',
        'nwNgdtwbkzNQPBC5yg1o': 'Puesto Playa',
        'EUOkq4RVYfsY5ZAZ1OUq': 'Puesto Hall Central',
        'MdAhlJ6ACqnBa25dEoRh': 'Puesto Hall Central',
        'Z4IyHVJfjBfn0HY3Zg3L': 'Puesto Hall Central',
        'kGTOnyRcEaT6j2HRciA3': 'Puesto Hall Central',
        '0KozY27p1igVpCEi3dYI': 'Puesto Salud Mnetal',
        'B4dLwkFxERlo3Zxvxbi9': 'Puesto Salud Mnetal',
        'RVD9nTqF5c4mrfMhDxow': 'Puesto Salud Mnetal',
        'kUqKPpQiwmdLiWc9A5Gn': 'Puesto Salud Mnetal',
        'nykgmzvH0qBHDbPpCuqM': 'Puesto Salud Mnetal',
    };
    const defaultShiftByEmp: Record<string, string> = {
        '7M4nUy7XDhsfxHB3g7Hz': 'M',
    };
    const dotacionCase: AutoLabCaseDefinition = { ...caseDef, defaultPositionByEmp, defaultShiftByEmp };
    const dotRun = runAutoLabCase(dotacionCase, 2026, 7, { employees });
    const dotOutcome = generateAutoLabSchedule(dotacionCase, dotRun);
    const dotGen = dotOutcome.generation!;
    const dotAssignments = dotGen.assignments;
    const dotPool = dotGen.stats.idleEmployeeIds ?? [];
    assert(!dotPool.includes(FARIAS), `dotación legajos: FARIAS fuera del pool (${dotPool.join(', ')})`);
    assert(
        dotGen.stats.primaryShiftByEmp?.[FARIAS] != null,
        `dotación legajos: FARIAS con banda primaria (${String(dotGen.stats.primaryShiftByEmp?.[FARIAS])})`,
    );
    const dotFariasPreVac = dotAssignments.filter(
        (a) => a.empId === FARIAS && a.dateStr >= '2026-07-01' && a.dateStr <= '2026-07-07',
    );
    const dotFariasBadPreVac = dotFariasPreVac.filter((a) => {
        const c = String(a.code || '').toUpperCase();
        return c === 'RET' || c === 'V';
    });
    assert(
        dotFariasBadPreVac.length === 0,
        `dotación legajos: FARIAS M/T/N antes de vacaciones (${dotFariasPreVac.map((a) => `${a.dateStr.slice(8)}:${a.code}`).join(' ')})`,
    );
    const dotBillable = dotAssignments.reduce((sum, a) => sum + (Number(a.hours) > 0 ? Number(a.hours) : 0), 0);
    assert(
        dotGen.stats.totalBillableHours === dotBillable,
        `dotación legajos: stats horas = sum assignments (${dotGen.stats.totalBillableHours} vs ${dotBillable})`,
    );
    assert(
        dotBillable <= 3100 && dotBillable >= 2800,
        `dotación legajos: horas facturables ~2976 (got ${dotBillable})`,
    );
    const dotExtRet = dotAssignments.filter((a) => a.empId.startsWith('lab-ret-ext'));
    assert(
        dotExtRet.length === 0,
        `dotación legajos: sin RET externo (${dotExtRet.length} celdas)`,
    );

    const LOPEZ = 'MdAhlJ6ACqnBa25dEoRh';
    const HALL = 'Puesto Hall Central';
    for (let d = 12; d <= 18; d++) {
        const ds = `2026-07-${String(d).padStart(2, '0')}`;
        const bands = new Set(
            dotAssignments
                .filter((a) => a.dateStr === ds && a.positionName === HALL && (Number(a.hours) || 0) > 0)
                .map((a) => String(a.code || '').toUpperCase()),
        );
        for (const band of ['M', 'T', 'N']) {
            assert(
                bands.has(band),
                `Hall Central ${ds.slice(8)} banda ${band} cubierta (tiene ${[...bands].join(',') || 'vacío'})`,
            );
        }
    }
    assert(
        dotPool.length === 3,
        `dotación legajos: 3 excedentes (got ${dotPool.length}: ${dotPool.join(', ')})`,
    );

    const dotacionSinBandaCase: AutoLabCaseDefinition = { ...caseDef, defaultPositionByEmp };
    const dotSinRun = runAutoLabCase(dotacionSinBandaCase, 2026, 7, { employees });
    const dotSinOutcome = generateAutoLabSchedule(dotacionSinBandaCase, dotSinRun);
    const dotSinGen = dotSinOutcome.generation!;
    const dotSinPool = dotSinGen.stats.idleEmployeeIds ?? [];
    assert(
        !dotSinPool.includes(FARIAS),
        `dotación sin banda fija: FARIAS fuera del pool por vacaciones planificadas (${dotSinPool.join(', ')})`,
    );
    assert(
        dotSinPool.length === 3,
        `dotación sin banda fija: 3 excedentes (got ${dotSinPool.length}: ${dotSinPool.join(', ')})`,
    );
    const dotSinFariasPreVac = dotSinGen.assignments.filter(
        (a) => a.empId === FARIAS && a.dateStr >= '2026-07-01' && a.dateStr <= '2026-07-07',
    );
    const dotSinFariasBad = dotSinFariasPreVac.filter((a) => {
        const c = String(a.code || '').toUpperCase();
        return c === 'RET';
    });
    assert(
        dotSinFariasBad.length === 0,
        `dotación sin banda fija: FARIAS sin RET antes de vacaciones (${dotSinFariasPreVac.map((a) => `${a.dateStr.slice(8)}:${a.code}`).join(' ')})`,
    );

    const soloVacacionesCase: AutoLabCaseDefinition = { ...caseDef, absencesByDate };
    const soloVacRun = runAutoLabCase(soloVacacionesCase, 2026, 7, { employees });
    const soloVacOutcome = generateAutoLabSchedule(soloVacacionesCase, soloVacRun);
    const soloVacPool = soloVacOutcome.generation?.stats.idleEmployeeIds ?? [];
    assert(
        !soloVacPool.includes(FARIAS),
        `solo vacaciones FARIAS (sin dotación legajos): fuera del pool (${soloVacPool.join(', ')})`,
    );

    const exportOrderEmployees: V2EmployeeDef[] = [
        '2h1CYgDiuInpBx0cPglf', 'U2krcGQjvKc6F6ZQC89A', 'cBmM3olST7Pa5MgsUMIr', 'cwo2Fizijo9ao6slIb64',
        '7M4nUy7XDhsfxHB3g7Hz', '1CQAtbfRTj9VOZhki3Xf', 'Z9w2MhRdifBl8U82nomq', 'lphLITYtzSGrRSxrjh7F',
        'nrrs1aBu7cdAZPY00KXp', 'nwNgdtwbkzNQPBC5yg1o', 'EUOkq4RVYfsY5ZAZ1OUq', 'MdAhlJ6ACqnBa25dEoRh',
        'Z4IyHVJfjBfn0HY3Zg3L', 'kGTOnyRcEaT6j2HRciA3', '0KozY27p1igVpCEi3dYI', 'B4dLwkFxERlo3Zxvxbi9',
        'RVD9nTqF5c4mrfMhDxow', 'kUqKPpQiwmdLiWc9A5Gn', 'nykgmzvH0qBHDbPpCuqM',
    ].map((id) => {
        const row = employees.find((e) => e.id === id)!;
        return { ...row };
    });
    const exportOrderCase: AutoLabCaseDefinition = {
        ...caseDef,
        defaultPositionByEmp,
        defaultShiftByEmp: { '7M4nUy7XDhsfxHB3g7Hz': 'M' },
        absencesByDate,
    };
    const exportOrderRun = runAutoLabCase(exportOrderCase, 2026, 7, { employees: exportOrderEmployees });
    const exportOrderOutcome = generateAutoLabSchedule(exportOrderCase, exportOrderRun);
    const exportOrderGen = exportOrderOutcome.generation!;
    const exportOrderPool = exportOrderGen.stats.idleEmployeeIds ?? [];
    assert(
        exportOrderPool.length === 3,
        `orden export Firestore: 3 excedentes (got ${exportOrderPool.length}: ${exportOrderPool.join(', ')})`,
    );
    assert(
        !exportOrderPool.includes(FARIAS),
        `orden export Firestore: FARIAS fuera del pool (${exportOrderPool.join(', ')})`,
    );
    for (let d = 12; d <= 18; d++) {
        const ds = `2026-07-${String(d).padStart(2, '0')}`;
        const bands = new Set(
            exportOrderGen.assignments
                .filter((a) => a.dateStr === ds && a.positionName === HALL && (Number(a.hours) || 0) > 0)
                .map((a) => String(a.code || '').toUpperCase()),
        );
        for (const band of ['M', 'T', 'N']) {
            assert(
                bands.has(band),
                `orden export Hall ${ds.slice(8)} banda ${band} (tiene ${[...bands].join(',') || 'vacío'})`,
            );
        }
    }

    if (failed) {
        console.error('\n=== eval:san-roque-postprocess FAILED ===');
        process.exit(1);
    }
    console.log('\n=== eval:san-roque-postprocess PASS ===');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
