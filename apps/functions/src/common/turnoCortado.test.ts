import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bloquesDeTurnoCortado,
  finUltimoTramoMs,
  planFichadaTramo,
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

  it('fichada por tramo: dentro del tramo 1 es el flujo normal', () => {
    const t1 = { ...TURNO, isPresent: true, realStartTime: ts('2026-11-18T12:00:00Z') };
    assert.deepEqual(planFichadaTramo(t1, new Date('2026-11-18T13:00:00Z').getTime()), { tipo: 'normal' });
    assert.deepEqual(planFichadaTramo(t1, new Date('2026-11-18T20:44:00Z').getTime()), { tipo: 'normal' });
  });

  it('fichada por tramo: desde 15 min antes del tramo 2 y con el tramo 1 fichado, toca el tramo 2', () => {
    const cerrado = { ...TURNO, isPresent: false, realStartTime: ts('2026-11-18T12:00:00Z'), presenciaBloques: { b1: { cerrado: true } } };
    const plan = planFichadaTramo(cerrado, new Date('2026-11-18T20:50:00Z').getTime());
    assert.equal(plan.tipo, 'tramo');
    if (plan.tipo === 'tramo') {
      assert.equal(plan.tramo, 2);
      assert.equal(plan.startMs, new Date('2026-11-18T21:00:00Z').getTime());
      assert.equal(plan.endMs, new Date('2026-11-19T01:00:00Z').getTime());
    }
  });

  it('fichada por tramo: si el tramo 2 ya tiene ingreso, ya está aplicada', () => {
    const t2 = { ...TURNO, isPresent: true, realStartTime: ts('2026-11-18T12:00:00Z'), presenciaBloques: { b2: { realStartTime: ts('2026-11-18T21:00:00Z') } } };
    assert.deepEqual(planFichadaTramo(t2, new Date('2026-11-18T21:30:00Z').getTime()), { tipo: 'ya', tramo: 2 });
  });

  it('fichada por tramo: sin ingreso en el tramo 1 no se salta al tramo 2', () => {
    assert.deepEqual(planFichadaTramo({ ...TURNO, isPresent: false }, new Date('2026-11-18T21:10:00Z').getTime()), { tipo: 'normal' });
  });
});
