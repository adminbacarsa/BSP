/**
 * npx tsx --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/operaciones/elegirTurnoWa.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elegirTurnoWa, msDeRawWa, WA_VENTANA_INGRESO_MS } from './elegirTurnoWa.ts';

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });

describe('elegirTurnoWa', () => {
  const phone = '3515465559';
  const tramo1 = {
    rowId: 'doc#b1',
    phone,
    name: 'ACUÑA, JUAN MANUEL',
    turnoStatus: 'PRESENT',
    startTimeRaw: ts('2026-11-24T09:30:00-03:00'),
    endTimeRaw: ts('2026-11-24T13:30:00-03:00'),
  };
  const tramo2 = {
    rowId: 'doc#b2',
    phone,
    name: 'ACUÑA, JUAN MANUEL',
    turnoStatus: 'PENDING',
    startTimeRaw: ts('2026-11-24T14:30:00-03:00'),
    endTimeRaw: ts('2026-11-24T18:30:00-03:00'),
  };

  it('ubicación después del fin del tramo 1 va a ese tramo, no al 2 pendiente', () => {
    const msg = new Date('2026-11-24T13:31:00-03:00').getTime();
    const elegido = elegirTurnoWa([tramo2, tramo1], 'Mauro', phone, msg);
    assert.equal(elegido?.rowId, 'doc#b1');
  });

  it('sin presente abierto, el pendiente futuro se elige aunque falte más de 30 min (para responderle)', () => {
    const msg = new Date('2026-11-24T13:31:00-03:00').getTime();
    const cerrado = { ...tramo1, turnoStatus: 'COMPLETED' };
    const elegido = elegirTurnoWa([cerrado, tramo2], 'Mauro', phone, msg);
    assert.equal(elegido?.rowId, 'doc#b2');
    assert.ok(msg < msDeRawWa(tramo2.startTimeRaw) - WA_VENTANA_INGRESO_MS);
  });

  it('dentro de T-30 el pendiente sí se elige', () => {
    const start = new Date('2026-11-24T14:30:00-03:00').getTime();
    const msg = start - WA_VENTANA_INGRESO_MS + 60_000;
    const elegido = elegirTurnoWa(
      [{ ...tramo1, turnoStatus: 'COMPLETED' }, tramo2],
      'Mauro',
      phone,
      msg,
    );
    assert.equal(elegido?.rowId, 'doc#b2');
  });

  it('presente en curso gana sobre un pendiente futuro', () => {
    const msg = new Date('2026-11-24T11:00:00-03:00').getTime();
    const elegido = elegirTurnoWa([tramo2, tramo1], 'Mauro', phone, msg);
    assert.equal(elegido?.rowId, 'doc#b1');
  });
});
