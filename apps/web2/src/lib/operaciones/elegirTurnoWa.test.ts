/**
 * npx tsx --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/operaciones/elegirTurnoWa.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  elegirTurnoWa,
  msDeRawWa,
  nombresCompatiblesWa,
  resolverTurnoWaIngreso,
  WA_VENTANA_INGRESO_MS,
} from './elegirTurnoWa.ts';

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
    const elegido = elegirTurnoWa([tramo2, tramo1], 'Juan Acuña', phone, msg);
    assert.equal(elegido?.rowId, 'doc#b1');
  });

  it('sin presente abierto, el pendiente futuro se elige aunque falte más de 30 min (para responderle)', () => {
    const msg = new Date('2026-11-24T13:31:00-03:00').getTime();
    const cerrado = { ...tramo1, turnoStatus: 'COMPLETED' };
    const elegido = elegirTurnoWa([cerrado, tramo2], 'Juan Acuña', phone, msg);
    assert.equal(elegido?.rowId, 'doc#b2');
    assert.ok(msg < msDeRawWa(tramo2.startTimeRaw) - WA_VENTANA_INGRESO_MS);
  });

  it('dentro de T-30 el pendiente sí se elige', () => {
    const start = new Date('2026-11-24T14:30:00-03:00').getTime();
    const msg = start - WA_VENTANA_INGRESO_MS + 60_000;
    const elegido = elegirTurnoWa(
      [{ ...tramo1, turnoStatus: 'COMPLETED' }, tramo2],
      'Juan Acuña',
      phone,
      msg,
    );
    assert.equal(elegido?.rowId, 'doc#b2');
  });

  it('presente en curso gana sobre un pendiente futuro', () => {
    const msg = new Date('2026-11-24T11:00:00-03:00').getTime();
    const elegido = elegirTurnoWa([tramo2, tramo1], 'Juan Acuña', phone, msg);
    assert.equal(elegido?.rowId, 'doc#b1');
  });

  it('el teléfono matchea aunque el pushName no calce; el nombre se valida después', () => {
    const msg = new Date('2026-11-24T16:36:00-03:00').getTime();
    const nahuel = {
      rowId: 'nahuel1',
      phone: '3517583423',
      name: 'NIEVAS, NAHUEL ALEJO',
      turnoStatus: 'PRESENT',
      startTimeRaw: ts('2026-11-24T10:30:00-03:00'),
      endTimeRaw: ts('2026-11-24T16:30:00-03:00'),
    };
    const elegido = elegirTurnoWa([nahuel], 'Franco Sartori', '3517583423', msg);
    assert.equal(elegido?.rowId, 'nahuel1');
    assert.equal(nombresCompatiblesWa('Franco Sartori', 'NIEVAS, NAHUEL ALEJO'), false);
  });

  it('sin teléfono no matchea por nombre fuzzy (evita cerrar turnos ajenos)', () => {
    const msg = new Date('2026-11-24T16:36:00-03:00').getTime();
    const elegido = elegirTurnoWa(
      [{ ...tramo1, phone: undefined }],
      'ACUÑA, JUAN MANUEL',
      null,
      msg,
    );
    assert.equal(elegido, undefined);
  });

  it('teléfono en otro legajo: resolver cae al turno propio por nombre', () => {
    const msg = new Date('2026-11-24T10:35:00-03:00').getTime();
    const r = resolverTurnoWaIngreso(
      [
        {
          rowId: 'acosta',
          phone: '3515416836',
          name: 'ACOSTA, JULIO',
          turnoStatus: 'PENDING',
          startTimeRaw: ts('2026-11-24T10:30:00-03:00'),
          endTimeRaw: ts('2026-11-24T18:30:00-03:00'),
        },
        {
          rowId: 'debora',
          phone: '3510000000',
          name: 'QUINTEROS, DEBORA',
          turnoStatus: 'PENDING',
          startTimeRaw: ts('2026-11-24T10:00:00-03:00'),
          endTimeRaw: ts('2026-11-24T18:00:00-03:00'),
        },
      ],
      'Debora Quinteros',
      '3515416836',
      msg,
    );
    assert.equal(r.turno?.rowId, 'debora');
    assert.equal(r.legajoTelefonoAjeno, undefined);
  });
});
