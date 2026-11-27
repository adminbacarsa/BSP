import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcPlanningBillableShiftHours,
  calcPlanningSlaReconciliationHours,
  shiftCoverageExtensionExtraHours,
} from './planningScheduledHours';
import { resolveShiftDurationHours } from '../../../../../packages/hours-core/src/motors/liquidation/reportesLiquidation';

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

test('Ops EXTEND con adjustedEndTime Timestamp (sin segment*): M 06–14 → 18:00 = 12 h', () => {
  // 06:00–14:00 AR = 09:00–17:00 Z; extensión a 18:00 AR = 21:00 Z
  const sh = {
    code: 'M',
    startTime: ts('2026-11-27T09:00:00.000Z'),
    endTime: ts('2026-11-27T17:00:00.000Z'),
    isExtended: true,
    adjustedEndTime: ts('2026-11-27T21:00:00.000Z'),
    extensionEndTime: ts('2026-11-27T21:00:00.000Z'),
  };
  assert.equal(shiftCoverageExtensionExtraHours(sh), 4);
  assert.equal(calcPlanningBillableShiftHours(sh, { M: 8 }), 12);
});

test('Ops ADVANCE con adjustedStartTime Timestamp (sin segment*): N 22–06 → desde 18:00 = 12 h', () => {
  // Banda N 22:00 AR (01:00 Z 28) → 06:00 AR (09:00 Z 28); adelanto 18:00 AR = 21:00 Z 27
  const sh = {
    code: 'N',
    startTime: ts('2026-11-28T01:00:00.000Z'),
    endTime: ts('2026-11-28T09:00:00.000Z'),
    isEarlyStart: true,
    adjustedStartTime: ts('2026-11-27T21:00:00.000Z'),
  };
  assert.equal(shiftCoverageExtensionExtraHours(sh), 4);
  assert.equal(calcPlanningBillableShiftHours(sh, { N: 8 }), 12);
});

test('ops_cov EXT/ADV con coverageHoursOnSource no suma horas (evita 12+4 en objetivo)', () => {
  const opsCov = {
    code: 'T',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'EXTEND',
    coverageHoursOnSource: true,
    startTime: ts('2026-11-27T17:00:00.000Z'), // 14:00 AR
    endTime: ts('2026-11-27T21:00:00.000Z'), // 18:00 AR
  };
  assert.equal(calcPlanningBillableShiftHours(opsCov, { T: 8 }), 0);
  assert.equal(resolveShiftDurationHours(opsCov, { T: 8 }, { forObjectiveBilling: true }), 0);
});
