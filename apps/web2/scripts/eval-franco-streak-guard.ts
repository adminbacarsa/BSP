/**
 * Smoke — franco guard: máx. 2 F; FF no se convierte a RET.
 */
import { enforceFrancoStreakRules } from '../src/lib/planificacion/francoStreakGuard';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

const ctx = {
    employees: [{ id: 'g1' }],
    daysInMonth: [new Date(2026, 6, 1), new Date(2026, 6, 2), new Date(2026, 6, 3)],
    getDateKey: (d: Date) =>
        `${d.getFullYear()}-07-${String(d.getDate()).padStart(2, '0')}`,
};

const cycleWorkDays = {
    g1: new Set(['2026-07-01', '2026-07-02', '2026-07-03']),
};

const ffAssignments = [
    { empId: 'g1', dateStr: '2026-07-01', code: 'FF', name: 'Franco feriado', hours: 0, startTime: '00:00', isFranco: true },
    { empId: 'g1', dateStr: '2026-07-02', code: 'FF', name: 'Franco feriado', hours: 0, startTime: '00:00', isFranco: true },
    { empId: 'g1', dateStr: '2026-07-03', code: 'FF', name: 'Franco feriado', hours: 0, startTime: '00:00', isFranco: true },
];

const ffCopy = ffAssignments.map((a) => ({ ...a }));
const ffResult = enforceFrancoStreakRules({
    assignments: ffCopy,
    ctx,
    cycleWorkDays,
});
assert(ffResult.convertedToRet === 0, 'FF nunca se convierte a RET');
assert(ffCopy.every((a) => a.code === 'FF'), 'FF permanece FF');

const fAssignments = [
    { empId: 'g1', dateStr: '2026-07-01', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true },
    { empId: 'g1', dateStr: '2026-07-02', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true },
    { empId: 'g1', dateStr: '2026-07-03', code: 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true },
];

const fResult = enforceFrancoStreakRules({
    assignments: fAssignments,
    ctx,
    cycleWorkDays: { g1: new Set<string>() },
});
assert(fResult.convertedToRet === 1, '3.er F ilegal → RET');
assert(fAssignments[2].code === 'RET', 'tercer F convertido a RET');
assert(fAssignments[0].code === 'F' && fAssignments[1].code === 'F', 'primeros 2 F se mantienen');

console.log('eval-franco-streak-guard: OK');
