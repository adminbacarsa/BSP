import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countPositionClosedUnitsFromShifts, type TurnoRelojCobertura } from './positionCoverageUnits';

const diasLv = ['L', 'M', 'X', 'J', 'V'];
const LUNES = '2026-10-05';

const museo = {
  positionName: 'Museo',
  qty: 1,
  coverageType: 'custom',
  shifts: [
    { code: 'MM', hours: 9, startTime: '08:00', endTime: '17:00', quantity: 3, days: diasLv },
    { code: 'ME', hours: 12, startTime: '07:00', endTime: '19:00', days: diasLv },
  ],
};

function mm(n: number): TurnoRelojCobertura[] {
  return Array.from({ length: n }, () => ({ code: 'MM', startTime: '08:00', endTime: '17:00', hours: 9 }));
}

function texto(u: { bandas?: Array<{ code: string; tiene: number; pide: number }> }) {
  return (u.bandas || []).map((b) => `${b.code} ${b.tiene}/${b.pide}`).join(' · ');
}

describe('Museo custom: cada franja con su PAX', () => {
  it('cierra con MM×3 + ME×1 y no marca sobrante aunque se superpongan', () => {
    const u = countPositionClosedUnitsFromShifts(
      museo,
      'L',
      { MM: 3, ME: 1 },
      undefined,
      true,
      LUNES,
      [...mm(3), { code: 'ME', startTime: '07:00', endTime: '19:00', hours: 12 }],
    );
    assert.equal(u.closed, 1);
    assert.equal(u.required, 1);
    assert.equal(u.sobra || 0, 0);
    assert.equal(texto(u), 'MM 3/3 · ME 1/1');
  });

  it('un MM de más sí marca sobrante', () => {
    const u = countPositionClosedUnitsFromShifts(
      museo,
      'L',
      { MM: 4, ME: 1 },
      undefined,
      true,
      LUNES,
      [...mm(4), { code: 'ME', startTime: '07:00', endTime: '19:00', hours: 12 }],
    );
    assert.equal(u.closed, 1);
    assert.equal(u.sobra, 1);
    assert.equal(texto(u), 'MM 4/3 · ME 1/1');
  });

  it('no cierra sin ME', () => {
    const u = countPositionClosedUnitsFromShifts(museo, 'L', { MM: 3 }, undefined, true, LUNES, mm(3));
    assert.equal(u.closed, 0);
    assert.equal(u.required, 1);
    assert.equal(texto(u), 'MM 3/3 · ME 0/1');
  });

  it('un sábado no pide las franjas de L–V', () => {
    const u = countPositionClosedUnitsFromShifts(museo, 'S', { MM: 3, ME: 1 }, undefined, true, '2026-10-10');
    assert.equal(u.required, 0);
    assert.equal(u.closed, 0);
  });
});

describe('24 h sin cambios (Casino)', () => {
  const guardia = {
    positionName: 'Guardia',
    qty: 2,
    coverageType: '24hs',
    shifts: [
      { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
      { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
      { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
      { code: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
      { code: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
    ],
  };

  it('dos juegos M+T+N cierran 2/2', () => {
    const u = countPositionClosedUnitsFromShifts(guardia, 'J', { M: 2, T: 2, N: 2 });
    assert.equal(u.closed, 2);
    assert.equal(u.required, 2);
  });

  it('un par D12+N12 cierra una sola unidad', () => {
    const u = countPositionClosedUnitsFromShifts(guardia, 'J', { D12: 1, N12: 1 });
    assert.equal(u.closed, 1);
    assert.equal(u.required, 2);
  });

  it('con quantity en 8 h y en 12 h sigue pidiendo solo M+T+N', () => {
    const conQty = {
      ...guardia,
      qty: 1,
      shifts: guardia.shifts.map((s) => ({ ...s, quantity: 1 })),
    };
    const u = countPositionClosedUnitsFromShifts(conQty, 'J', { M: 1, T: 1, N: 1 });
    assert.equal(u.closed, 1);
    assert.equal(u.required, 1);
    assert.deepEqual((u.bandas || []).map((b) => b.code), ['M', 'T', 'N']);
  });
});
