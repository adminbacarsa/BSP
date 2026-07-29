/**
 * Smoke case-02: Depósito M+T — RET fin de semana intercalado entre puestos.
 * Ejecutar: npx tsx apps/web2/scripts/eval-case-02-deposito-mt.ts
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
    const { generateAutoLabSchedule } = await import('../src/lib/planificacion/autoLabSchedule');

    const caseDef = AUTO_LAB_CASES.find((c) => c.id === 'case-02-deposito-mt');
    if (!caseDef) throw new Error('case-02 not found');

    const employees = [
        { id: 'lab-emp-01', nombre: 'G01' },
        { id: 'lab-emp-02', nombre: 'G02' },
    ];
    const run = runAutoLabCase(caseDef, 2026, 7, { employees });
    const outcome = generateAutoLabSchedule(caseDef, run);
    const assignments = outcome.generation?.assignments ?? [];

    const DAY = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    const getDayLetter = (ds: string) => DAY[new Date(`${ds}T12:00:00`).getDay()];
    const weekendDays = run.daysInMonth
        .map((d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        })
        .filter((ds) => ['S', 'D'].includes(getDayLetter(ds)));

    let failed = false;
    const assert = (cond: boolean, msg: string) => {
        if (!cond) {
            console.error('FAIL:', msg);
            failed = true;
        } else console.log('OK:', msg);
    };

    for (const ds of weekendDays) {
        const letter = getDayLetter(ds);
        const g01 = assignments.find((a) => a.empId === 'lab-emp-01' && a.dateStr === ds);
        const g02 = assignments.find((a) => a.empId === 'lab-emp-02' && a.dateStr === ds);
        const c01 = String(g01?.code ?? '').toUpperCase();
        const c02 = String(g02?.code ?? '').toUpperCase();
        assert(!!g01 && !!g02, `${ds}: ambos guardias con celda`);
        assert(['F', 'RET'].includes(c01) && ['F', 'RET'].includes(c02), `${ds}: solo F/RET (${c01}, ${c02})`);
        const retCount = (c01 === 'RET' ? 1 : 0) + (c02 === 'RET' ? 1 : 0);
        assert(retCount === 1, `${ds} (${letter}): exactamente 1 RET (${c01}/${c02})`);
    }

    const satRetG01 = weekendDays.filter((ds) =>
        getDayLetter(ds) === 'S'
        && assignments.some((a) => a.empId === 'lab-emp-01' && a.dateStr === ds && String(a.code).toUpperCase() === 'RET'),
    ).length;
    const sunRetG01 = weekendDays.filter((ds) =>
        getDayLetter(ds) === 'D'
        && assignments.some((a) => a.empId === 'lab-emp-01' && a.dateStr === ds && String(a.code).toUpperCase() === 'RET'),
    ).length;
    assert(satRetG01 >= 1 && sunRetG01 >= 1, `G01 alterna RET sáb/dom (${satRetG01} sáb, ${sunRetG01} dom)`);

    if (failed) process.exit(1);
    console.log('=== eval:case-02-deposito-mt PASS ===');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
