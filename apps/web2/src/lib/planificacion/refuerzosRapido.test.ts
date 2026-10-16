import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agregarRfzfAPosiciones, fechasDeTexto, fechasRfzf, franjasParaMesSiguiente, normalizarHora } from './refuerzosRapido';

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

  it('RFZF PP de Casino: puesto nuevo con sigla desde el 10/10; en noviembre todos los días', () => {
    const todos = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
    const t = agregarRfzfAPosiciones([{ name: 'Guardia', allowedShiftTypes: [{ code: 'M' }] }], { inicio: '15:00', fin: '22:00', dias: [...todos], pax: 1, puesto: 'PP', sigla: 'T', desde: '2026-10-10' });
    const n = agregarRfzfAPosiciones(t.positions, { inicio: '22:00', fin: '05:00', dias: [...todos], pax: 1, puesto: 'PP', sigla: 'N', desde: '2026-10-10' });
    const pp = n.positions.find((p) => p.name === 'PP')!;
    assert.deepEqual(pp.allowedShiftTypes!.map((x) => x.code), ['T', 'N']);
    assert.equal((pp.allowedShiftTypes![0].specificDates as string[]).length, 22);
    assert.equal((pp.allowedShiftTypes![0].specificDates as string[])[0], '2026-10-10');
    const nov = franjasParaMesSiguiente(n.positions, '2026-11').find((p) => p.name === 'PP')!;
    assert.deepEqual(nov.allowedShiftTypes!.map((x) => [x.code, x.specificDates, x.days, x.refuerzoFijo]), [['T', undefined, undefined, undefined], ['N', undefined, undefined, undefined]]);
  });

  it('RFZF solo martes y jueves desde el 10: en noviembre queda M·J', () => {
    const r = agregarRfzfAPosiciones([], { inicio: '08:00', fin: '16:00', dias: ['M', 'J'], pax: 1, puesto: 'Playa', sigla: 'RF', desde: '2026-10-10' });
    const nov = franjasParaMesSiguiente(r.positions, '2026-11')[0];
    assert.deepEqual(nov.allowedShiftTypes![0].days, ['M', 'J']);
  });

  it('franja con fechas sin marca: hasta fin de mes seguidas pasa entera; si no, se saca; las del mes nuevo quedan', () => {
    const fechas = Array.from({ length: 22 }, (_, i) => `2026-10-${String(10 + i).padStart(2, '0')}`);
    const pos = [{ name: 'PP', allowedShiftTypes: [{ code: 'T', specificDates: fechas }, { code: 'RM', specificDates: ['2026-10-20', '2026-10-21'] }, { code: 'X', specificDates: ['2026-10-31', '2026-11-02'] }] }];
    const nov = franjasParaMesSiguiente(pos, '2026-11')[0];
    assert.deepEqual(nov.allowedShiftTypes!.map((x) => [x.code, x.specificDates]), [['T', undefined], ['X', ['2026-11-02']]]);
  });

  it('fechas del eventual: sueltas y rango que cruza de mes', () => {
    assert.deepEqual(fechasDeTexto('20/10, 21/10', 2026), ['2026-10-20', '2026-10-21']);
    assert.deepEqual(fechasDeTexto('28/10-2/11', 2026), ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    assert.deepEqual(fechasDeTexto('30/12-2/1', 2026), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('un pax más en una franja que ya existe desde el 15: ese mes resta el pax del 1 al 14; el mes siguiente queda ×3', () => {
    const r = agregarRfzfAPosiciones([{ name: 'Guardia', quantity: 2, allowedShiftTypes: [{ code: 'M', startTime: '07:00', endTime: '15:00', quantity: 2 }] }],
      { inicio: '07:00', fin: '15:00', dias: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], pax: 1, puesto: 'Guardia', sigla: 'M', desde: '2026-10-15' });
    const g = r.positions[0];
    assert.equal(g.allowedShiftTypes![0].quantity, 3);
    const cortes = g.excludedShiftPaxDates as Record<string, Record<string, number>>;
    assert.equal(Object.keys(cortes).length, 14);
    assert.deepEqual(cortes['2026-10-01'], { M: 1 });
    assert.equal(cortes['2026-10-15'], undefined);
    const nov = franjasParaMesSiguiente(r.positions, '2026-11')[0];
    assert.equal(nov.allowedShiftTypes![0].quantity, 3);
    assert.deepEqual(nov.excludedShiftPaxDates, {});
  });
});

