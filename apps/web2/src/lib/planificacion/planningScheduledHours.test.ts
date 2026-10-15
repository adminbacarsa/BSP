import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcPlanningBillableShiftHours, calcPlanningSlaReconciliationHours } from './planningScheduledHours';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

test('turno extendido: la base es el turno guardado (M 10–16 de Puesto 2 + 16–22 = 12 h, base 6), no la M de 8 h', () => {
  const sh = {
    code: 'M',
    startTime: ts('2026-10-02T13:00:00.000Z'),
    endTime: ts('2026-10-02T19:00:00.000Z'),
    isExtended: true,
    isEarlyStart: false,
    coverageSegmentRole: 'EXTENSION',
    coversPositionName: 'Puesto 2',
    segmentFromTime: '16:00',
    segmentToTime: '22:00',
    extExtraHours: 6,
  };
  for (const hint of [undefined, { M: 8 }]) {
    assert.equal(calcPlanningBillableShiftHours(sh, hint), 12);
    assert.equal(calcPlanningSlaReconciliationHours(sh, hint), 6);
  }
  const m8 = { ...sh, startTime: ts('2026-10-02T10:00:00.000Z'), endTime: ts('2026-10-02T18:00:00.000Z'), segmentFromTime: '15:00', segmentToTime: '19:00', extExtraHours: 4 };
  assert.equal(calcPlanningBillableShiftHours(m8, { M: 8 }), 12);
  assert.equal(calcPlanningSlaReconciliationHours(m8, { M: 8 }), 8);
});
