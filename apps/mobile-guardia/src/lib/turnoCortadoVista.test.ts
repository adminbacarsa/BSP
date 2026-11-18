/**
 * Turno cortado en el portal del guardia: qué tramo se muestra y ficha según la hora.
 *
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/turnoCortadoVista.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hayTurnoCortado,
  tramoActivoDeTurnoCortado,
  vistaTurnoCortado,
} from '../../../../packages/portal-core/src/shifts/turnoCortadoVista.ts';
import { getCheckInTiming } from '../../../../packages/portal-core/src/checkIn/portalCheckIn.ts';

const BLOQUES = [{ startTime: '09:00', endTime: '14:00' }, { startTime: '18:00', endTime: '22:00' }];
// 09:00 AR = 12:00 UTC
function turno(extra: Record<string, unknown> = {}): any {
  return {
    id: 't1',
    blocks: BLOQUES,
    startTime: new Date('2026-11-18T12:00:00Z'),
    endTime: new Date('2026-11-18T17:00:00Z'),
    status: 'PENDING',
    isPresent: false,
    ...extra,
  };
}
const ms = (iso: string) => new Date(iso).getTime();

describe('turno cortado en el portal del guardia', () => {
  it('un turno de un solo horario no cambia', () => {
    const s: any = { id: 'x', startTime: new Date('2026-11-18T12:00:00Z') };
    assert.equal(hayTurnoCortado([s]), false);
    assert.equal(vistaTurnoCortado(s, ms('2026-11-18T22:00:00Z')), s);
  });

  it('dentro del tramo 1 se muestra el turno tal cual', () => {
    const s = turno({ isPresent: true, realStartTime: new Date('2026-11-18T12:00:00Z') });
    assert.equal(hayTurnoCortado([s]), true);
    assert.equal(vistaTurnoCortado(s, ms('2026-11-18T13:00:00Z')), s);
  });

  it('con el tramo 1 cerrado y cerca del tramo 2 se muestra el tramo 2 listo para fichar', () => {
    const s = turno({
      realStartTime: new Date('2026-11-18T12:00:00Z'),
      checkInAt: new Date('2026-11-18T12:01:00Z'),
      presenciaBloques: { b1: { cerrado: true } },
    });
    const now = ms('2026-11-18T20:50:00Z');
    assert.equal(tramoActivoDeTurnoCortado(s, now)?.tramo, 2);
    const v: any = vistaTurnoCortado(s, now);
    assert.equal(v.id, 't1');
    assert.equal(v.isPresent, false);
    assert.equal(v.realStartTime, null);
    assert.equal(v.checkInAt, null);
    assert.equal(new Date(v.startTime).toISOString(), '2026-11-18T21:00:00.000Z');
    assert.equal(new Date(v.endTime).toISOString(), '2026-11-19T01:00:00.000Z');
    assert.equal(getCheckInTiming(v, new Date(now)).canCheckIn, true);
  });

  it('con el ingreso del tramo 2 se muestra con la hora de ese tramo', () => {
    const s = turno({
      isPresent: true,
      status: 'PRESENT',
      realStartTime: new Date('2026-11-18T12:00:00Z'),
      presenciaBloques: { b2: { realStartTime: new Date('2026-11-18T21:00:00Z') } },
    });
    const v: any = vistaTurnoCortado(s, ms('2026-11-18T21:30:00Z'));
    assert.equal(new Date(v.realStartTime).toISOString(), '2026-11-18T21:00:00.000Z');
    assert.equal(v.isPresent, true);
  });

  it('sin ingreso en el tramo 1 no se salta al tramo 2', () => {
    const v: any = vistaTurnoCortado(turno(), ms('2026-11-18T21:10:00Z'));
    assert.equal(new Date(v.startTime).toISOString(), '2026-11-18T12:00:00.000Z');
  });
});
