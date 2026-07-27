/**
 * Smoke: analyzeCoveragePolicyBalance — detecta falta y exceso por banda.
 */
import { analyzeCoveragePolicyBalance } from '../src/lib/planificacion/coveragePolicyBalance';
import type { V2Assignment, V2EngineContext, V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

const pos: V2PositionDef = {
    positionName: 'Puesto Test',
    qty: 1,
    coverageType: '24hs',
    shifts: [
        { code: 'M', name: 'Mañana', hours: 8 },
        { code: 'T', name: 'Tarde', hours: 8 },
        { code: 'N', name: 'Noche', hours: 8 },
    ],
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
};

const days = [new Date(2026, 6, 15)];
const ctx: V2EngineContext = {
    positions: [pos],
    employees: [{ id: 'e1', nombre: 'A' }, { id: 'e2', nombre: 'B' }],
    daysInMonth: days,
    getDateKey: (d) => '2026-07-15',
    getDayLetter: () => 'M',
    absences: {},
    autoCycles: ['6+2'],
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

const balanced: V2Assignment[] = [
    { empId: 'e1', dateStr: '2026-07-15', positionName: 'Puesto Test', code: 'M', hours: 8, startTime: '07:00' },
    { empId: 'e2', dateStr: '2026-07-15', positionName: 'Puesto Test', code: 'T', hours: 8, startTime: '15:00' },
];
const r1 = analyzeCoveragePolicyBalance(ctx, balanced);
assert(r1.ok === false && r1.underSlotCount === 1, 'falta N con solo M+T');

const over: V2Assignment[] = [
    ...balanced,
    { empId: 'e2', dateStr: '2026-07-15', positionName: 'Puesto Test', code: 'N', hours: 8, startTime: '23:00' },
    { empId: 'e1', dateStr: '2026-07-15', positionName: 'Puesto Test', code: 'N', hours: 8, startTime: '23:00' },
];
const r2 = analyzeCoveragePolicyBalance(ctx, over);
assert(r2.overSlotCount === 1, 'detecta doble N');

if (failed) {
    console.error('\n=== eval:coverage-policy-balance FAILED ===');
    process.exit(1);
}
console.log('\n=== eval:coverage-policy-balance PASS ===');
