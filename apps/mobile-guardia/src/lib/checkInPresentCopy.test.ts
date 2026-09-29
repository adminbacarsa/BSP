/**
 * Hero fichado: Ingresaste HH:MM con la hora de pago (realStartTime).
 * Hasta T+5 es el inicio planificado; desde T+6, la fichada con N min tarde.
 * node --experimental-strip-types --test src/lib/checkInPresentCopy.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Shift } from '@cosp/portal-types';
import { formatTimeAr } from '../../../../packages/portal-core/src/utils/dates.ts';
import { resolveCheckInUiStatus } from '../../../../packages/portal-core/src/checkIn/checkInUiStatus.ts';

const start = new Date('2026-09-29T11:00:00.000Z');

function presentShift(partial: Partial<Shift>): Shift {
  return {
    id: 'araya',
    isPresent: true,
    startTime: start,
    ...partial,
  };
}

describe('resolveCheckInUiStatus — hora de pago', () => {
  it('tarde (T+17): Ingresaste HH:MM (N min tarde)', () => {
    const at = new Date(start.getTime() + 17 * 60 * 1000);
    const view = resolveCheckInUiStatus(presentShift({ checkInAt: at, realStartTime: at }), null);
    assert.equal(view.title, `Ingresaste ${formatTimeAr(at)} (17 min tarde)`);
    assert.equal(view.status, 'present');
    assert.doesNotMatch(view.title, /comenzó/);
  });

  it('sin checkInAt usa realStartTime', () => {
    const at = new Date(start.getTime() + 12 * 60 * 1000);
    const view = resolveCheckInUiStatus(presentShift({ realStartTime: at }), null);
    assert.equal(view.title, `Ingresaste ${formatTimeAr(at)} (12 min tarde)`);
  });

  it('dentro de T+5 muestra el inicio planificado y la fichada aparte', () => {
    const at = new Date(start.getTime() + 3 * 60 * 1000);
    const view = resolveCheckInUiStatus(presentShift({ checkInAt: at, realStartTime: start }), null);
    assert.equal(view.title, `Ingresaste ${formatTimeAr(start)}`);
    assert.equal(view.subtitle, `Marcaste ${formatTimeAr(at)}`);
  });

  it('fichó antes: muestra el inicio planificado', () => {
    const at = new Date(start.getTime() - 9 * 60 * 1000);
    const view = resolveCheckInUiStatus(presentShift({ checkInAt: at }), null);
    assert.equal(view.title, `Ingresaste ${formatTimeAr(start)}`);
    assert.equal(view.title.includes('tarde'), false);
    assert.equal(view.subtitle, `Marcaste ${formatTimeAr(at)}`);
  });

  it('sin hora real no inventa el inicio planificado', () => {
    const view = resolveCheckInUiStatus(presentShift({}), null);
    assert.equal(view.title, 'Presente confirmado');
    assert.doesNotMatch(view.title, /8:00|08:00|comenzó/);
  });
});
