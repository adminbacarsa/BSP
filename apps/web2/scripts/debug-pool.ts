process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';

async function main() {
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule } = await import('../src/lib/planificacion/autoLabSchedule');
    const { buildSurplusEmployeePool } = await import('../src/lib/planificacion/surplusAbsentSubstitution');
    const { runStrictSixTwoPipeline } = await import('../src/lib/planificacion/planningPipeline');

    const M = [
        { code: 'M', name: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', name: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', name: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
        { code: 'D12', name: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', name: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
    ];
    const positions = ['Puesto Rondin', 'Puesto Playa', 'Puesto Hall Central', 'Puesto Salud Mnetal'].map((n) => ({
        positionName: n, qty: 1, coverageType: '24hs' as const, shifts: M, activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    }));
    const employees = [
        ['0KozY27p1igVpCEi3dYI', 'CABRAL'], ['1CQAtbfRTj9VOZhki3Xf', 'DIAZ'], ['2h1CYgDiuInpBx0cPglf', 'BAZAN'],
        ['7M4nUy7XDhsfxHB3g7Hz', 'FARIAS'], ['B4dLwkFxERlo3Zxvxbi9', 'HERRERA'], ['EUOkq4RVYfsY5ZAZ1OUq', 'VALDEZ'],
        ['MdAhlJ6ACqnBa25dEoRh', 'LOPEZ'], ['RVD9nTqF5c4mrfMhDxow', 'ARAMAYO'], ['U2krcGQjvKc6F6ZQC89A', 'OLIVEDA'],
        ['Z4IyHVJfjBfn0HY3Zg3L', 'GUZMAN'], ['Z9w2MhRdifBl8U82nomq', 'MONTERO'], ['cBmM3olST7Pa5MgsUMIr', 'TORRES'],
        ['cwo2Fizijo9ao6slIb64', 'SOLIS'], ['kGTOnyRcEaT6j2HRciA3', 'SCHOOP'], ['kUqKPpQiwmdLiWc9A5Gn', 'ACOSTA'],
        ['lphLITYtzSGrRSxrjh7F', 'ALONSO'], ['nrrs1aBu7cdAZPY00KXp', 'ZIEGE'], ['nwNgdtwbkzNQPBC5yg1o', 'ROMERO'],
        ['nykgmzvH0qBHDbPpCuqM', 'MENDEZ'],
    ].map(([id, nombre]) => ({ id, nombre, preferredObjectiveId: 'x' }));

    const absencesByDate = [
        ...Array.from({ length: 7 }, (_, i) => ({ empId: 'MdAhlJ6ACqnBa25dEoRh', dateStr: `2026-07-${String(12 + i).padStart(2, '0')}`, code: 'V' })),
        ...Array.from({ length: 14 }, (_, i) => ({ empId: '7M4nUy7XDhsfxHB3g7Hz', dateStr: `2026-07-${String(8 + i).padStart(2, '0')}`, code: 'V' })),
    ];
    const caseDef = {
        id: 'case-real-service', order: 6, title: 'x', subtitle: 'x', description: 'x',
        expectations: [], coverageNotes: '', positions, employeeCount: 19, cycle: '6+2',
        rotationMode: 'rotative', slaVendidas: 2976, serviceStartDate: '2026-07-01',
        serviceEndDate: '2026-07-31', absencesByDate,
    };
    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const outcome = generateAutoLabSchedule(caseDef, run);
    const raw = runStrictSixTwoPipeline({
        positions: run.positions,
        employees: run.employees.map((e) => ({ ...e, preferredObjectiveId: 'auto-lab-case-real-service' })),
        daysInMonth: run.daysInMonth,
        calendarDaysInMonth: run.calendarDaysInVigencia,
        serviceExcludedDates: run.serviceExcludedDates,
        absences: run.absences,
        slaVendidas: run.slaVendidas,
        autoCycles: run.brain.cycles,
        objectiveId: 'auto-lab-case-real-service',
        budgetMode: 'cct' as const,
        getDayLetter: (ds: string) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(`${ds}T12:00:00`).getDay()],
        getDateKey: (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        rotateShifts: false,
        demandDriven: false,
        noFlexSchemeEmployees: true,
        allowFrancoWorkedRescue: false,
        headcountByPax: true,
    });

    const FARIAS = '7M4nUy7XDhsfxHB3g7Hz';
    const rawStats = raw.generation.stats;
    console.log('RAW idle', rawStats.idleEmployeeIds);
    console.log('RAW primary FARIAS', rawStats.primaryShiftByEmp?.[FARIAS]);
    console.log('RAW opening FARIAS', rawStats.openingSlotByEmp?.[FARIAS]);
    console.log('Rondin group', rawStats.positionGroups?.['Puesto Rondin']);

    const poolRaw = buildSurplusEmployeePool(rawStats, employees.map((e) => e.id), positions, '6+2', 16);
    console.log('pool from RAW', poolRaw, 'FARIAS in', poolRaw.includes(FARIAS));

    const gen = outcome.generation!;
    const poolPost = buildSurplusEmployeePool(gen.stats, employees.map((e) => e.id), positions, '6+2', 16);
    console.log('pool from POST stats', poolPost);
    console.log('POST primary FARIAS', gen.stats.primaryShiftByEmp?.[FARIAS]);
    const fJul1 = gen.assignments.filter((a) => a.empId === FARIAS && a.dateStr <= '2026-07-07');
    console.log('FARIAS week1', fJul1.map((a) => `${a.dateStr.slice(8)}:${a.code}`).join(' '));
    console.log('totalBillable', gen.stats.totalBillableHours);
}

main();
