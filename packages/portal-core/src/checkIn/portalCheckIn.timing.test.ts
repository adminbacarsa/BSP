import { describe, expect, it } from 'vitest';
import { getCheckInTiming, isOperationsCoverageShift } from './portalCheckIn';
import type { Shift } from '@cosp/portal-types';

function shift(partial: Partial<Shift> & Pick<Shift, 'id'>): Shift {
  return partial as Shift;
}

describe('getCheckInTiming — cobertura ops vs turno normal', () => {
  const now = new Date('2026-09-14T18:00:00-03:00');

  it('detecta OPERATIONS_COVERAGE', () => {
    expect(isOperationsCoverageShift({ origin: 'OPERATIONS_COVERAGE' })).toBe(true);
    expect(isOperationsCoverageShift({ origin: 'PLANIFICADOR' })).toBe(false);
  });

  it('turno normal: fuera de ventana ±15/−5 no puede fichar', () => {
    const s = shift({
      id: 'n1',
      origin: 'PLANIFICADOR',
      startTime: new Date('2026-09-14T20:00:00-03:00'),
      endTime: new Date('2026-09-15T04:00:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(false);
    expect(t.tooEarly).toBe(true);
  });

  it('cobertura ops: puede fichar antes del inicio si el turno no terminó', () => {
    const s = shift({
      id: 'c1',
      origin: 'OPERATIONS_COVERAGE',
      startTime: new Date('2026-09-14T20:00:00-03:00'),
      endTime: new Date('2026-09-15T04:00:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(true);
    expect(t.tooEarly).toBe(false);
    expect(t.lateWindow).toBe(false);
  });

  it('cobertura ops: no puede fichar si el turno ya terminó', () => {
    const s = shift({
      id: 'c2',
      origin: 'OPERATIONS_COVERAGE',
      startTime: new Date('2026-09-14T08:00:00-03:00'),
      endTime: new Date('2026-09-14T16:00:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(false);
  });
});
