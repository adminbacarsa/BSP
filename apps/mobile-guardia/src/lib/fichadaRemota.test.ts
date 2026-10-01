/**
 * La fichada remota y el día completo valen solo con el flag del legajo.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/fichadaRemota.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arCalendarDay,
  getCheckInTiming,
  validateCheckInDistance,
} from '../../../../packages/portal-core/src/checkIn/portalCheckIn.ts';
import { evaluateServerCheckInWindow } from '../../../../apps/functions/src/fichajes/checkInWindow.ts';
import {
  REVIEW_EMAIL,
  REVIEW_EMPRESA,
  buildReviewEmployee,
  reviewDays,
} from '../../../../scripts/crear-usuario-review-play.mjs';

function at(hh: number, mm = 0) {
  const day = arCalendarDay(Date.now());
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh + 3, mm, 0));
}

describe('fichadaRemota — solo el legajo de revisión', () => {
  it('el script marca bypass y fichada remota, sin clave en el doc', () => {
    const doc = buildReviewEmployee('uid-review') as Record<string, unknown>;
    assert.equal(doc.email, REVIEW_EMAIL);
    assert.equal(doc.empresaId, REVIEW_EMPRESA);
    assert.equal(doc.bypassDeviceCheck, true);
    assert.equal(doc.fichadaRemota, true);
    assert.equal('password' in doc, false);
    assert.equal(reviewDays(new Date('2026-10-01T12:00:00Z'), 30).length, 30);
  });

  it('sin el flag, lejos del objetivo no se ficha', () => {
    const far = validateCheckInDistance(
      { lat: -31.42, lng: -64.18, name: 'Objetivo' },
      { latitude: -34.6, longitude: -58.38 },
    );
    assert.equal(far.ok, false);
  });

  it('con el flag, ficha desde cualquier lugar y a cualquier hora del día del turno', () => {
    const anywhere = validateCheckInDistance(
      { lat: -31.42, lng: -64.18, name: 'Objetivo' },
      { latitude: -34.6, longitude: -58.38 },
      { fichadaRemota: true },
    );
    assert.equal(anywhere.ok, true);

    const start = at(7);
    const night = at(22);
    const shift = { code: 'M', startTime: start, endTime: at(15), isFranco: false };
    const timing = getCheckInTiming(shift as never, night, { fichadaRemota: true });
    assert.equal(timing.canCheckIn, true);

    const server = evaluateServerCheckInWindow(
      { startTime: { toMillis: () => start.getTime() }, endTime: { toMillis: () => at(15).getTime() } },
      night.getTime(),
      { fichadaRemota: true },
    );
    assert.equal(server.allowed, true);
    assert.equal(server.usePlannedStart, true);
  });

  it('otro legajo, de noche, sigue fuera de ventana', () => {
    const start = at(7);
    const night = at(22);
    const timing = getCheckInTiming(
      { code: 'M', startTime: start, endTime: at(15), isFranco: false } as never,
      night,
    );
    assert.equal(timing.canCheckIn, false);
  });
});
