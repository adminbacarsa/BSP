/**
 * Smoke: días activos del puesto derivados desde allowedShiftTypes[].days (L–V).
 * Ejecutar: npm run eval:sla-active-days (desde apps/web2 o raíz)
 */
import {
    derivePlanningPositionActiveDays,
    formatPositionActiveDaysLabel,
    normalizePlanningShifts,
} from '../src/lib/planningPositionDays';
import { positionIsActiveOn } from '../src/lib/planificacion/autoScheduleEngineV2';
import type { V2PositionDef } from '../src/lib/planificacion/autoScheduleEngineV2';

function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

const weekdayShift = {
    code: 'MA',
    name: 'Mañana',
    startTime: '08:00',
    endTime: '17:00',
    hours: 9,
    days: ['L', 'M', 'X', 'J', 'V'],
};

const positions = [
    {
        name: 'Museo',
        coverageType: 'custom',
        quantity: 4,
        allowedShiftTypes: [weekdayShift],
    },
    {
        name: 'DIRECTORIO',
        coverageType: 'custom',
        quantity: 2,
        allowedShiftTypes: [{ ...weekdayShift, code: 'ME', startTime: '08:00', endTime: '20:00', hours: 12 }],
    },
    {
        name: 'Puesto 1',
        coverageType: '24hs',
        quantity: 4,
        allowedShiftTypes: [
            { code: 'M', hours: 8 },
            { code: 'T', hours: 8 },
            { code: 'N', hours: 8 },
        ],
    },
];

for (const raw of positions) {
    const shifts = normalizePlanningShifts(raw.allowedShiftTypes);
    const activeDays = derivePlanningPositionActiveDays(undefined, shifts);
    const pos = { positionName: raw.name, shifts, activeDays, qty: raw.quantity };

    if (raw.name === 'Puesto 1') {
        assert(activeDays.length === 7, 'Puesto 24hs sigue L–D');
        assert(formatPositionActiveDaysLabel(activeDays) === 'L–D', 'Puesto 24hs label L–D');
        continue;
    }

    assert(activeDays.join('') === 'LMXJV', `${raw.name}: activeDays debe ser L–V`);
    assert(formatPositionActiveDaysLabel(activeDays) === 'L–V', `${raw.name}: label L–V`);
    assert(shifts[0].days?.join('') === 'LMXJV', `${raw.name}: shift.days preservado`);

    const v2: V2PositionDef = {
        positionName: pos.positionName,
        qty: pos.qty,
        coverageType: 'custom',
        activeDays: pos.activeDays,
        shifts: pos.shifts.map((s) => ({
            code: s.code,
            hours: s.hours,
            days: s.days,
            startTime: s.startTime,
            endTime: s.endTime,
        })),
    };
    assert(!positionIsActiveOn(v2, 'S'), `${raw.name}: no opera sábado`);
    assert(!positionIsActiveOn(v2, 'D'), `${raw.name}: no opera domingo`);
    assert(positionIsActiveOn(v2, 'L'), `${raw.name}: opera lunes`);
}

const derived = derivePlanningPositionActiveDays(undefined, [{ days: ['L', 'M', 'X', 'J', 'V'] }]);
assert(derived.join('') === 'LMXJV', 'derive sin pos.activeDays');

console.log('eval-sla-active-days: OK');
