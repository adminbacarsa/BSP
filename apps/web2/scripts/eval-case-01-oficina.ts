/**
 * Smoke case-01: Oficina custom L–V solo M.
 * Ejecutar: npm run eval:case-01-oficina
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'x';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'x';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'x';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'x';

async function main() {
    const { AUTO_LAB_CASES } = await import('../src/lib/planificacion/autoLabCaseCatalog');
    const { runAutoLabCase } = await import('../src/lib/planificacion/autoLabRuntime');
    const { generateAutoLabSchedule, buildAutoLabGenContext } = await import('../src/lib/planificacion/autoLabSchedule');
    const { generateScheduleV4 } = await import('../src/lib/planificacion/autoScheduleEngineV4');
    const { isCustomCoverPosition } = await import('../src/lib/planificacion/autoScheduleEngineV2');

    const caseDef = AUTO_LAB_CASES.find((c) => c.id === 'case-01-oficina-m');
    if (!caseDef) throw new Error('case-01 not found');

    const employees = [{ id: 'lab-emp-01', nombre: 'Guardia 01' }];
    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const ctx = buildAutoLabGenContext(caseDef, run, run.brain);

    console.log('rotateShifts', ctx.rotateShifts);
    console.log('isCustom', isCustomCoverPosition(ctx.positions[0]));

    const engineOnly = generateScheduleV4(ctx);
    const motorCodes = engineOnly.assignments
        .filter((a) => a.empId === 'lab-emp-01')
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
        .map((a) => `${a.dateStr.slice(8)}:${a.code}`);
    console.log('motor', motorCodes.join(' '));
    console.log('motor uncovered', engineOnly.stats.uncoveredSlots);

    const outcome = generateAutoLabSchedule(caseDef, run);
    const finalCodes = (outcome.generation?.assignments ?? [])
        .filter((a) => a.empId === 'lab-emp-01')
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr))
        .map((a) => `${a.dateStr.slice(8)}:${a.code}`);
    console.log('final', finalCodes.join(' '));
    console.log('pipeline', outcome.pipeline);
    console.log('uncovered', outcome.generation?.stats.uncoveredSlots);

    const bad = (outcome.generation?.assignments ?? []).filter(
        (a) => a.empId === 'lab-emp-01' && ['T', 'N'].includes(String(a.code).toUpperCase()),
    );
    if (bad.length > 0) {
        console.error('FAIL: turnos T/N en custom solo-M:', bad.length);
        process.exit(1);
    }
    const weekendWork = (outcome.generation?.assignments ?? []).filter((a) => {
        if (a.empId !== 'lab-emp-01') return false;
        const d = new Date(`${a.dateStr}T12:00:00`).getDay();
        if (d !== 0 && d !== 6) return false;
        return (Number(a.hours) || 0) > 0;
    });
    if (weekendWork.length > 0) {
        console.error('FAIL: trabajo en fin de semana:', weekendWork.map((a) => a.dateStr));
        process.exit(1);
    }
    console.log('=== eval:case-01-oficina PASS ===');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
