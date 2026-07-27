process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';

async function main() {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule } = await import('../src/lib/planificacion/autoLabSchedule');
    const { analyzeCoveragePolicyBalance } = await import('../src/lib/planificacion/coveragePolicyBalance');
    const { buildSurplusEmployeePool } = await import('../src/lib/planificacion/surplusAbsentSubstitution');
    type AutoLabCaseDefinition = import('../src/lib/planificacion/autoLabCaseCatalog').AutoLabCaseDefinition;
    type V2EmployeeDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2EmployeeDef;
    type V2PositionDef = import('../src/lib/planificacion/autoScheduleEngineV2').V2PositionDef;

    const M = [
        { code: 'M', name: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
        { code: 'D12', name: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', name: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
    ];
    const positions: V2PositionDef[] = [
        'Puesto Rondin', 'Puesto Playa', 'Puesto Hall Central', 'Puesto Salud Mnetal',
    ].map((n) => ({
        positionName: n, qty: 1, coverageType: '24hs' as const, shifts: M,
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        ...(n === 'Puesto Playa' ? { excludedDates: ['2026-06-07', '2026-06-14', '2026-06-21'] } : {}),
    }));

    const rows: Array<[string, string]> = [
        ['0KozY27p1igVpCEi3dYI', 'CABRAL'], ['1CQAtbfRTj9VOZhki3Xf', 'DIAZ'], ['2h1CYgDiuInpBx0cPglf', 'BAZAN'],
        ['7M4nUy7XDhsfxHB3g7Hz', 'FARIAS'], ['B4dLwkFxERlo3Zxvxbi9', 'HERRERA'], ['EUOkq4RVYfsY5ZAZ1OUq', 'VALDEZ'],
        ['MdAhlJ6ACqnBa25dEoRh', 'LOPEZ'], ['RVD9nTqF5c4mrfMhDxow', 'ARAMAYO'], ['U2krcGQjvKc6F6ZQC89A', 'OLIVEDA'],
        ['Z4IyHVJfjBfn0HY3Zg3L', 'GUZMAN'], ['Z9w2MhRdifBl8U82nomq', 'MONTERO'], ['cBmM3olST7Pa5MgsUMIr', 'TORRES'],
        ['cwo2Fizijo9ao6slIb64', 'SOLIS'], ['kGTOnyRcEaT6j2HRciA3', 'SCHOOP'], ['kUqKPpQiwmdLiWc9A5Gn', 'ACOSTA'],
        ['lphLITYtzSGrRSxrjh7F', 'ALONSO'], ['nrrs1aBu7cdAZPY00KXp', 'ZIEGE'], ['nwNgdtwbkzNQPBC5yg1o', 'ROMERO'],
        ['nykgmzvH0qBHDbPpCuqM', 'MENDEZ'],
    ];
    const employees: V2EmployeeDef[] = rows.map(([id, nombre]) => ({
        id, nombre, preferredObjectiveId: 'auto-lab-case-real-service',
    }));

    const defaultPositionByEmp: Record<string, string> = {
        '2h1CYgDiuInpBx0cPglf': 'Puesto Rondin', 'U2krcGQjvKc6F6ZQC89A': 'Puesto Rondin',
        'cBmM3olST7Pa5MgsUMIr': 'Puesto Rondin', 'cwo2Fizijo9ao6slIb64': 'Puesto Rondin',
        '7M4nUy7XDhsfxHB3g7Hz': 'Puesto Rondin',
        '1CQAtbfRTj9VOZhki3Xf': 'Puesto Playa', 'Z9w2MhRdifBl8U82nomq': 'Puesto Playa',
        'lphLITYtzSGrRSxrjh7F': 'Puesto Playa', 'nrrs1aBu7cdAZPY00KXp': 'Puesto Playa',
        'nwNgdtwbkzNQPBC5yg1o': 'Puesto Playa',
        'EUOkq4RVYfsY5ZAZ1OUq': 'Puesto Hall Central', 'MdAhlJ6ACqnBa25dEoRh': 'Puesto Hall Central',
        'Z4IyHVJfjBfn0HY3Zg3L': 'Puesto Hall Central', 'kGTOnyRcEaT6j2HRciA3': 'Puesto Hall Central',
        '0KozY27p1igVpCEi3dYI': 'Puesto Salud Mnetal', 'B4dLwkFxERlo3Zxvxbi9': 'Puesto Salud Mnetal',
        'RVD9nTqF5c4mrfMhDxow': 'Puesto Salud Mnetal', 'kUqKPpQiwmdLiWc9A5Gn': 'Puesto Salud Mnetal',
        'nykgmzvH0qBHDbPpCuqM': 'Puesto Salud Mnetal',
    };

    const absencesByDate = [
        ...Array.from({ length: 7 }, (_, i) => ({
            empId: 'MdAhlJ6ACqnBa25dEoRh', dateStr: `2026-07-${String(12 + i).padStart(2, '0')}`, code: 'V',
        })),
        ...Array.from({ length: 14 }, (_, i) => ({
            empId: '7M4nUy7XDhsfxHB3g7Hz', dateStr: `2026-07-${String(8 + i).padStart(2, '0')}`, code: 'V',
        })),
    ];

    const caseDef: AutoLabCaseDefinition = {
        id: 'case-real-service', order: 6, title: 'x', subtitle: 'x', description: 'x',
        expectations: [], coverageNotes: '', positions, employeeCount: 19, cycle: '6+2',
        rotationMode: 'rotative', slaVendidas: 2976, serviceStartDate: '2026-07-01',
        serviceEndDate: '2026-07-31', absencesByDate, defaultPositionByEmp,
    };

    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const outcome = generateAutoLabSchedule(caseDef, run);
    const gen = outcome.generation!;
    const ctx = {
        positions, employees, absences: run.absences,
        daysInMonth: run.daysInMonth,
        getDateKey: (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        getDayLetter: (ds: string) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(`${ds}T12:00:00`).getDay()],
        defaultPositionByEmp, defaultShiftByEmp: undefined as Record<string, string> | undefined,
        autoCycles: ['6+2'] as string[],
    };

    console.log('pool', gen.stats.idleEmployeeIds);
    console.log('retFloater', gen.stats.retFloaterEmpIds);
    console.log('billable', gen.stats.totalBillableHours);
    console.log('balance', outcome.coveragePolicyBalance?.summary);
    console.log('under', outcome.coveragePolicyBalance?.underCoverage?.slice(0, 5));
    console.log('over', outcome.coveragePolicyBalance?.overCoverage?.slice(0, 5));
    console.log('substitutions', outcome.surplusSubstitutionActions?.length);

    const HALL = 'Puesto Hall Central';
    const LOPEZ = 'MdAhlJ6ACqnBa25dEoRh';
    for (let d = 12; d <= 18; d++) {
        const ds = `2026-07-${String(d).padStart(2, '0')}`;
        const hall = gen.assignments.filter((a) => a.dateStr === ds && a.positionName === HALL && (a.hours ?? 0) > 0);
        const bands = hall.map((a) => `${a.empId.slice(0, 6)}:${a.code}`).join(' ');
        console.log(`Hall ${ds.slice(8)}`, bands || 'VACIO');
    }

    const poolRaw = buildSurplusEmployeePool(
        gen.stats, employees.map((e) => e.id), positions, '6+2', 16,
        { defaultPositionByEmp, absences: run.absences },
    );
    console.log('pool rebuild', poolRaw);

    const balance = analyzeCoveragePolicyBalance(ctx as never, gen.assignments);
    console.log('balance direct', balance.underSlotCount, balance.overSlotCount);
}

main();
