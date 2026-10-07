/**
 * npx tsx --test src/lib/operaciones/fichadaCoberturaFuente.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { heredarFichadaDeFuente } from './fichadaCoberturaFuente.ts';

describe('CC hereda la fichada de la fuente', () => {
  it('oculta el REF presente y muestra el ops_cov activo', () => {
    const start = new Date('2026-10-07T11:45:00-03:00');
    const end = new Date('2026-10-07T15:30:00-03:00');
    const checkInAt = { seconds: Math.floor(new Date('2026-10-07T11:37:08-03:00').getTime() / 1000) };
    const ref = {
      id: 'Z3AY',
      code: 'REF',
      employeeId: 'KOPP',
      origin: 'PLAN',
      isPresent: true,
      status: 'PRESENT',
      checkInAt,
      realStartTime: checkInAt,
      shiftDateObj: start,
      endDateObj: end,
    };
    const cov = {
      id: 'ops_cov_M2_KOPP',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'REF',
      sourceShiftId: 'Z3AY',
      employeeId: 'KOPP',
      code: 'M2',
      isPresent: false,
      status: 'PENDING',
      shiftDateObj: start,
      endDateObj: end,
    };
    const ocultar = heredarFichadaDeFuente([ref, cov]);
    assert.deepEqual([...ocultar], ['Z3AY']);
    assert.equal(cov.isPresent, true);
    assert.equal(cov.status, 'PRESENT');
    assert.equal(cov.checkInAt, checkInAt);
  });
});
