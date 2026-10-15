import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sugerenciasSueltas } from './continuarSueltos';
import type { CeldaPropuesta } from './continuarMesAnterior';

const vifood = [
  { positionName: 'Vifood · Puesto 1', qty: 1, shifts: [{ code: 'VFM', name: 'VFM', startTime: '07:00', endTime: '15:00', hours: 8, days: ['S', 'D'] }] },
  { positionName: 'Vifood · Puesto 2', qty: 1, shifts: [{ code: 'VF', name: 'VF', startTime: '08:00', endTime: '20:00', hours: 12 }] },
];
const peaje = { positionName: 'Peaje · Puesto', qty: 1, shifts: [{ code: 'M', name: 'M', startTime: '07:00', endTime: '15:00', hours: 8 }] };
const letra = (d: string) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(`${d}T12:00`).getDay()];
const habilitado = (pos: string, code: string, d: string) => code !== 'VFM' || ['S', 'D'].includes(letra(d));
const celda = (employeeId: string, dateStr: string, code: string, positionName = ''): CeldaPropuesta => ({
  employeeId, dateStr, code, name: code, positionName, startTime: '', endTime: '', hours: 0, isFranco: code === 'F',
});
const historia = [
  // ENSABELLA hizo VFM dos domingos de octubre; su ciclo es M de Peaje.
  { employeeId: 'ens', nombre: 'ENSABELLA', previos: [
    { dateStr: '2026-10-18', code: 'VFM', positionName: 'Vifood · Puesto 1' },
    { dateStr: '2026-10-25', code: 'VFM', positionName: 'Vifood · Puesto 1' },
  ] },
];
const base = {
  dias: ['2026-11-01', '2026-11-02'],
  turnoHabilitado: habilitado,
  historia,
  cargado: () => null,
  libre: () => true,
  mesAnteriorLabel: 'octubre',
};
const albani = { employeeId: 'alb', nombre: 'ALBANI', propuestas: [celda('alb', '2026-11-01', 'VF', 'Vifood · Puesto 2'), celda('alb', '2026-11-02', 'VF', 'Vifood · Puesto 2')] };

describe('Continuar: turnos sueltos del mes anterior', () => {
  it('si es su franco y al día siguiente su M sobra, mueve el franco (sin FT)', () => {
    const out = sugerenciasSueltas({
      ...base,
      estructura: vifood,
      resultados: [{ employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'F'), celda('ens', '2026-11-02', 'M', 'Peaje · Puesto')] }, albani],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].celda.employeeId, 'ens');
    assert.equal(out[0].celda.code, 'VFM');
    assert.equal(out[0].celda.startTime, '07:00');
    assert.equal(out[0].francoTrabajado, false);
    assert.equal(out[0].francoA, '2026-11-02');
    assert.match(out[0].texto, /dom 01\/11 · VFM .* ENSABELLA 2 domingos · su franco pasa al lun 02\/11 \(sin FT\)/);
  });

  it('si su turno del otro día hace falta, lo hace en su franco (turno común, como el mes anterior)', () => {
    const out = sugerenciasSueltas({
      ...base,
      estructura: [...vifood, peaje],
      resultados: [{ employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'F'), celda('ens', '2026-11-02', 'M', 'Peaje · Puesto')] }, albani],
    });
    const vfm = out.filter((s) => s.celda.code === 'VFM');
    assert.equal(vfm.length, 1);
    assert.equal(vfm[0].francoTrabajado, false);
    assert.equal(vfm[0].francoA, undefined);
    assert.match(vfm[0].texto, /lo hace en su franco, como el mes anterior/);
  });

  it('alguien libre ese día va antes que mover un franco', () => {
    const out = sugerenciasSueltas({
      ...base,
      estructura: vifood,
      historia: [...historia, { employeeId: 'oli', nombre: 'OLMEDO', previos: [{ dateStr: '2026-10-11', code: 'VFM', positionName: 'Vifood · Puesto 1' }] }],
      resultados: [
        { employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'F'), celda('ens', '2026-11-02', 'M', 'Peaje · Puesto')] },
        { employeeId: 'oli', nombre: 'OLMEDO', propuestas: [celda('oli', '2026-11-02', 'M', 'Peaje · Puesto')] },
        albani,
      ],
    });
    const vfm = out.filter((s) => s.celda.code === 'VFM');
    assert.equal(vfm.length, 1);
    assert.equal(vfm[0].celda.employeeId, 'oli');
    assert.equal(vfm[0].francoTrabajado, false);
  });

  it('si ese día ya trabaja, no se lo propone', () => {
    const out = sugerenciasSueltas({
      ...base,
      dias: ['2026-11-01'],
      estructura: vifood,
      resultados: [
        { employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'M', 'Peaje · Puesto')] },
        { employeeId: 'alb', nombre: 'ALBANI', propuestas: [celda('alb', '2026-11-01', 'VF', 'Vifood · Puesto 2')] },
      ],
    });
    assert.equal(out.length, 0);
  });
});

describe('Continuar: el turno suelto no parte un bloque de francos', () => {
  it('no se pone entre dos francos (F R1 F)', () => {
    const out = sugerenciasSueltas({
      dias: ['2026-11-01', '2026-11-02', '2026-11-03'],
      estructura: [{ positionName: 'Vifood · Puesto 1', qty: 1, shifts: [{ code: 'VFM', name: 'VFM', startTime: '07:00', endTime: '15:00', hours: 8 }] }],
      turnoHabilitado: (_p: string, _c: string, d: string) => d === '2026-11-02',
      historia: [{ employeeId: 'ens', nombre: 'ENSABELLA', previos: [{ dateStr: '2026-10-26', code: 'VFM', positionName: 'Vifood · Puesto 1' }] }],
      resultados: [{ employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'F'), celda('ens', '2026-11-02', 'F'), celda('ens', '2026-11-03', 'F')] }],
      cargado: () => null,
      libre: () => true,
      mesAnteriorLabel: 'octubre',
    });
    assert.equal(out.length, 0);
  });
});
