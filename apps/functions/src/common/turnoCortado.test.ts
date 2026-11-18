import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bloquesDeTurnoCortado,
  finUltimoTramoMs,
  tramosDeTurnoCortado,
  turnoCortadoConPresencia,
  turnoCortadoEnCurso,
} from './turnoCortado.ts';

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });
const BLOQUES = [{ startTime: '09:00', endTime: '14:00' }, { startTime: '18:00', endTime: '22:00' }];
// 09:00 AR = 12:00 UTC
const TURNO = { blocks: BLOQUES, startTime: ts('2026-11-18T12:00:00Z'), endTime: ts('2026-11-18T17:00:00Z') };

describe('turno cortado en functions', () => {
  it('un turno de un solo horario no es cortado', () => {
    assert.equal(bloquesDeTurnoCortado({ blocks: [{ startTime: '09:00', endTime: '14:00' }] }), null);
    assert.equal(finUltimoTramoMs({ startTime: ts('2026-11-18T12:00:00Z'), endTime: ts('2026-11-18T17:00:00Z') }), 0);
  });

  it('el fin del turno es el del último tramo, no el del primero', () => {
    assert.equal(finUltimoTramoMs(TURNO), new Date('2026-11-19T01:00:00Z').getTime());
  });

  it('respeta un endTime ya corrido al fin del tramo 2', () => {
    const corrido = { ...TURNO, endTime: ts('2026-11-19T01:00:00Z') };
    assert.equal(finUltimoTramoMs(corrido), new Date('2026-11-19T01:00:00Z').getTime());
  });

  it('en el corte entre tramos sigue en curso; después del último tramo no', () => {
    assert.equal(turnoCortadoEnCurso(TURNO, new Date('2026-11-18T17:30:00Z').getTime()), true);
    assert.equal(turnoCortadoEnCurso(TURNO, new Date('2026-11-18T23:00:00Z').getTime()), true);
    assert.equal(turnoCortadoEnCurso(TURNO, new Date('2026-11-19T01:00:00Z').getTime()), false);
  });

  it('un tramo que cruza medianoche pasa al día siguiente', () => {
    const tramos = tramosDeTurnoCortado(new Date('2026-11-18T12:00:00Z').getTime(), [
      { startTime: '18:00', endTime: '23:00' },
      { startTime: '01:00', endTime: '04:00' },
    ]);
    assert.equal(tramos[1].startMs, new Date('2026-11-19T04:00:00Z').getTime());
    assert.equal(tramos[1].endMs, new Date('2026-11-19T07:00:00Z').getTime());
  });

  it('presencia: fichó el tramo 1 aunque el corte lo deje PENDING', () => {
    assert.equal(turnoCortadoConPresencia({ ...TURNO, isPresent: false }), false);
    assert.equal(turnoCortadoConPresencia({ ...TURNO, isPresent: true }), true);
    assert.equal(turnoCortadoConPresencia({ ...TURNO, realStartTime: ts('2026-11-18T12:02:00Z') }), true);
    assert.equal(turnoCortadoConPresencia({ ...TURNO, presenciaBloques: { b2: { realStartTime: ts('2026-11-18T21:00:00Z') } } }), true);
    assert.equal(turnoCortadoConPresencia({ startTime: TURNO.startTime, isPresent: true }), false);
  });
});
