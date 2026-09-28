import { describe, expect, it } from 'vitest';
import {
  getCheckInTiming,
  isCoverageHoursOnSourceShift,
  isOperationsCoverageShift,
  validateCheckInDistance,
  checkInRejectMessage,
} from './portalCheckIn';
import type { Shift } from '@cosp/portal-types';
import { isShiftVisibleToEmployee } from '../shifts/employeeShiftVisibility';

function shift(partial: Partial<Shift> & Pick<Shift, 'id'> & Record<string, unknown>): Shift {
  return partial as Shift;
}

describe('getCheckInTiming — ventanas CC (paridad server)', () => {
  const now = new Date('2026-09-14T18:00:00-03:00');

  it('detecta OPERATIONS_COVERAGE', () => {
    expect(isOperationsCoverageShift({ origin: 'OPERATIONS_COVERAGE' })).toBe(true);
    expect(isOperationsCoverageShift({ origin: 'PLANIFICADOR' })).toBe(false);
  });

  it('normal: demasiado temprano (antes de T−60) no ficha ni avisa', () => {
    const s = shift({
      id: 'n1',
      origin: 'PLANIFICADOR',
      startTime: new Date('2026-09-14T20:00:00-03:00'),
      endTime: new Date('2026-09-15T04:00:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.diffMinutes).toBe(120);
    expect(t.canCheckIn).toBe(false);
    expect(t.tooEarly).toBe(true);
    expect(t.rejectCode).toBe('TOO_EARLY');
    expect(t.canNotifyLate).toBe(false);
  });

  it('normal: dentro de T−15 puede fichar', () => {
    const start = new Date('2026-09-14T18:10:00-03:00');
    const s = shift({
      id: 'n2',
      startTime: start,
      endTime: new Date('2026-09-15T02:10:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.diffMinutes).toBe(10);
    expect(t.canCheckIn).toBe(true);
    expect(t.canNotifyLate).toBe(true);
  });

  it('aviso previo: canNotifyLate de T−60 a T+5 (no solo post T+5)', () => {
    const s = shift({
      id: 'late-pre',
      startTime: new Date('2026-09-14T18:45:00-03:00'),
      endTime: new Date('2026-09-15T02:45:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.diffMinutes).toBe(45);
    expect(t.canCheckIn).toBe(false);
    expect(t.canNotifyLate).toBe(true);
    expect(t.lateWindow).toBe(true);
  });

  it('con lateArrivalAt + lateArrivalEtaAt: canCheckIn hasta min(etaAt, T+60)', () => {
    const start = new Date('2026-09-14T17:50:00-03:00');
    const s = shift({
      id: 'late-eta',
      startTime: start,
      endTime: new Date('2026-09-15T01:50:00-03:00'),
      lateArrivalAt: new Date('2026-09-14T17:40:00-03:00'),
      lateArrivalEtaAt: new Date(start.getTime() + 30 * 60_000),
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(true);
    expect(t.canNotifyLate).toBe(false);
    expect(t.checkInDeadline?.getTime()).toBe(start.getTime() + 30 * 60_000);
  });

  it('con lateArrivalConfirmed sin etaAt: ventana hasta T+30 (paridad server)', () => {
    const start = new Date('2026-09-14T17:40:00-03:00');
    const s = shift({
      id: 'late-30',
      startTime: start,
      endTime: new Date('2026-09-15T01:40:00-03:00'),
      lateArrivalConfirmed: true,
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(true);
    const after = getCheckInTiming(s, new Date('2026-09-14T18:15:00-03:00'));
    expect(after.canCheckIn).toBe(false);
    expect(after.rejectCode).toBe('TOO_LATE');
  });

  it('OPERATIONS_COVERAGE: desde inicio−15 hasta max(createdAt, inicio)+60', () => {
    const start = new Date('2026-09-14T20:00:00-03:00');
    const created = new Date('2026-09-14T17:30:00-03:00');
    const s = shift({
      id: 'ops1',
      origin: 'OPERATIONS_COVERAGE',
      startTime: start,
      endTime: new Date('2026-09-15T04:00:00-03:00'),
      createdAt: created,
    });
    const early = getCheckInTiming(s, now);
    expect(early.canCheckIn).toBe(false);
    expect(early.tooEarly).toBe(true);

    const inWin = getCheckInTiming(s, new Date('2026-09-14T19:50:00-03:00'));
    expect(inWin.canCheckIn).toBe(true);
    expect(inWin.checkInDeadline?.getTime()).toBe(start.getTime() + 60 * 60_000);

    const late = getCheckInTiming(s, new Date('2026-09-14T21:01:00-03:00'));
    expect(late.canCheckIn).toBe(false);
  });

  it('OPERATIONS_COVERAGE: coverageCreatedAt si no hay createdAt', () => {
    const start = new Date('2026-09-14T17:00:00-03:00');
    const created = new Date('2026-09-14T17:30:00-03:00');
    const s = shift({
      id: 'ops2',
      origin: 'OPERATIONS_COVERAGE',
      startTime: start,
      endTime: new Date('2026-09-15T01:00:00-03:00'),
      coverageCreatedAt: created,
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(true);
    expect(t.checkInDeadline?.getTime()).toBe(created.getTime() + 60 * 60_000);
  });

  it('ADV (isEarlyStart): adjustedStartTime −15 … +60', () => {
    const start = new Date('2026-09-14T20:00:00-03:00');
    const s = shift({
      id: 'adv1',
      startTime: start,
      endTime: new Date('2026-09-15T04:00:00-03:00'),
      isEarlyStart: true,
      adjustedStartTime: '18:00',
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(true);
    const deadline = t.checkInDeadline!;
    expect(deadline.toISOString()).toBe(new Date('2026-09-14T19:00:00-03:00').toISOString());
  });

  it('ADV: si no llegó al adelanto, igual puede fichar en ventana propia T−15…T+5', () => {
    const s = shift({
      id: 'adv-own',
      startTime: new Date('2026-09-14T20:00:00-03:00'),
      endTime: new Date('2026-09-15T04:00:00-03:00'),
      isEarlyStart: true,
      adjustedStartTime: '14:00',
    });
    const atOwnWindow = getCheckInTiming(s, new Date('2026-09-14T19:50:00-03:00'));
    expect(atOwnWindow.canCheckIn).toBe(true);
    expect(atOwnWindow.canNotifyLate).toBe(true);

    const between = getCheckInTiming(s, new Date('2026-09-14T19:20:00-03:00'));
    expect(between.canCheckIn).toBe(false);
    expect(between.canNotifyLate).toBe(true);
  });

  it('ADV + lateArrivalEtaAt: ventana propia extendida', () => {
    const start = new Date('2026-09-14T17:50:00-03:00');
    const s = shift({
      id: 'adv-late',
      startTime: start,
      endTime: new Date('2026-09-15T01:50:00-03:00'),
      isEarlyStart: true,
      adjustedStartTime: '12:00',
      lateArrivalAt: new Date('2026-09-14T17:40:00-03:00'),
      lateArrivalEtaAt: new Date(start.getTime() + 30 * 60_000),
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(true);
  });

  it('coverageHoursOnSource / coverageType EXTEND|ADVANCE: no fichable', () => {
    const s = shift({
      id: 'reg1',
      origin: 'OPERATIONS_COVERAGE',
      coverageHoursOnSource: true,
      startTime: new Date('2026-09-14T18:00:00-03:00'),
      endTime: new Date('2026-09-15T02:00:00-03:00'),
      createdAt: new Date('2026-09-14T17:00:00-03:00'),
    });
    expect(isCoverageHoursOnSourceShift(s)).toBe(true);
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(false);
    expect(t.rejectCode).toBe('TRACE_REGISTRATION');
    expect(t.rejectMessage).toBe(checkInRejectMessage('TRACE_REGISTRATION'));
    expect(isShiftVisibleToEmployee(s as never, new Set(['any']))).toBe(false);

    const byType = shift({
      id: 'reg2',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'ADVANCE',
      startTime: new Date('2026-09-14T18:00:00-03:00'),
      endTime: new Date('2026-09-15T02:00:00-03:00'),
    });
    expect(isCoverageHoursOnSourceShift(byType)).toBe(true);
    expect(getCheckInTiming(byType, now).rejectCode).toBe('TRACE_REGISTRATION');
  });

  it('SHIFT_ENDED: mensaje claro; retenido no ficha', () => {
    const s = shift({
      id: 'ended',
      isRetention: true,
      isPresent: true,
      startTime: new Date('2026-09-14T06:00:00-03:00'),
      endTime: new Date('2026-09-14T14:00:00-03:00'),
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(false);
    expect(t.rejectCode).toBe('SHIFT_ENDED');
    expect(t.rejectMessage).toMatch(/terminó/i);
  });

  it('ausente: no puede fichar', () => {
    const s = shift({
      id: 'abs1',
      startTime: new Date('2026-09-14T18:00:00-03:00'),
      endTime: new Date('2026-09-15T02:00:00-03:00'),
      isAbsent: true,
      status: 'ABSENT',
    });
    const t = getCheckInTiming(s, now);
    expect(t.canCheckIn).toBe(false);
    expect(t.rejectCode).toBe('ABSENT');
    expect(t.canNotifyLate).toBe(false);
  });
});

describe('validateCheckInDistance — GPS CC', () => {
  it('permite fichar si el objetivo no tiene coordenadas', () => {
    const r = validateCheckInDistance({ lat: 0, lng: 0, name: 'Sin GPS' }, null);
    expect(r.ok).toBe(true);
  });

  it('permite con allowRemoteCheckIn', () => {
    const r = validateCheckInDistance(
      { lat: -31.4, lng: -64.2, name: 'Remoto', allowRemoteCheckIn: true },
      null,
    );
    expect(r.ok).toBe(true);
  });

  it('bloquea fuera del radio', () => {
    const r = validateCheckInDistance(
      { lat: -31.4, lng: -64.2, name: 'Planta' },
      { latitude: -31.5, longitude: -64.3 },
    );
    expect(r.ok).toBe(false);
  });
});
