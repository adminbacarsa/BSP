import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agregarRfzfAPosiciones, fechasRfzf, normalizarHora } from './refuerzosRapido';

describe('refuerzos desde el modo rápido', () => {
  it('RFZF V·S·D desde el 10 hasta fin de octubre', () => {
    assert.deepEqual(fechasRfzf('2026-10-10', ['V', 'S', 'D']), [
      '2026-10-10', '2026-10-11', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-30', '2026-10-31',
    ]);
  });
  it('crea el puesto RFZF; mismo horario suma pax; otro horario es otra franja', () => {
    const a = agregarRfzfAPosiciones([{ name: 'Puesto 1', allowedShiftTypes: [{ code: 'M' }] }], { inicio: '12:00', fin: '22:00', dias: ['S', 'D'], pax: 1 });
    assert.equal(a.code, 'RFZF');
    const rfzf = a.positions.find((p) => p.name === 'RFZF');
    assert.deepEqual(rfzf?.allowedShiftTypes?.[0], { code: 'RFZF', name: 'Refuerzo fijo', startTime: '12:00', endTime: '22:00', hours: 10, quantity: 1, days: ['S', 'D'] });
    const b = agregarRfzfAPosiciones(a.positions, { inicio: '12:00', fin: '22:00', dias: ['V'], pax: 1 });
    const b1 = b.positions.find((p) => p.name === 'RFZF')!.allowedShiftTypes![0];
    assert.equal(b1.quantity, 2);
    assert.deepEqual(b1.days, ['V', 'S', 'D']);
    const c = agregarRfzfAPosiciones(b.positions, { inicio: '11:00', fin: '23:00', dias: ['S'], pax: 1 });
    assert.equal(c.code, 'RFZF2');
    assert.equal(c.positions.find((p) => p.name === 'RFZF')!.allowedShiftTypes!.length, 2);
  });
  it('completa la hora', () => {
    assert.equal(normalizarHora('6'), '06:00');
    assert.equal(normalizarHora('630'), '06:30');
    assert.equal(normalizarHora('22:00'), '22:00');
  });
});
