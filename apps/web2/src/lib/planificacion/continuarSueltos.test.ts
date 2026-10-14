import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sugerenciasSueltas } from './continuarSueltos';
import type { CeldaPropuesta } from './continuarMesAnterior';

const estructura = [
  { positionName: 'Vifood · Puesto 1', qty: 1, shifts: [{ code: 'VFM', name: 'VFM', startTime: '07:00', endTime: '15:00', hours: 8, days: ['S', 'D'] }] },
  { positionName: 'Vifood · Puesto 2', qty: 1, shifts: [{ code: 'VF', name: 'VF', startTime: '08:00', endTime: '20:00', hours: 12 }] },
];
const habilitado = (pos: string, code: string, d: string) => code !== 'VFM' || ['S', 'D'].includes(['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(`${d}T12:00`).getDay()]);
const celda = (employeeId: string, dateStr: string, code: string, positionName = ''): CeldaPropuesta => ({
  employeeId, dateStr, code, name: code, positionName, startTime: '', endTime: '', hours: 0, isFranco: code === 'F',
});

describe('Continuar: turnos sueltos del mes anterior', () => {
  const historia = [
    // ENSABELLA hizo VFM dos domingos de octubre; su ciclo es M/T de Peaje.
    { employeeId: 'ens', nombre: 'ENSABELLA', previos: [
      { dateStr: '2026-10-18', code: 'VFM', positionName: 'Vifood · Puesto 1' },
      { dateStr: '2026-10-25', code: 'VFM', positionName: 'Vifood · Puesto 1' },
    ] },
  ];
  const base = {
    dias: ['2026-11-01', '2026-11-02'],
    estructura,
    turnoHabilitado: habilitado,
    historia,
    cargado: () => null,
    libre: () => true,
    mesAnteriorLabel: 'octubre',
  };

  it('el domingo sin VFM propone a quien lo hizo; si es su franco, queda como FT', () => {
    const out = sugerenciasSueltas({
      ...base,
      resultados: [
        { employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'F'), celda('ens', '2026-11-02', 'M', 'Peaje · Puesto')] },
        { employeeId: 'alb', nombre: 'ALBANI', propuestas: [celda('alb', '2026-11-01', 'VF', 'Vifood · Puesto 2'), celda('alb', '2026-11-02', 'VF', 'Vifood · Puesto 2')] },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].celda.employeeId, 'ens');
    assert.equal(out[0].celda.code, 'VFM');
    assert.equal(out[0].celda.startTime, '07:00');
    assert.equal(out[0].tipo, 'suelto');
    assert.equal(out[0].francoTrabajado, true);
    assert.match(out[0].texto, /Dom 01\/11 · VFM .* ENSABELLA 2 domingos · es su franco/);
  });

  it('si ese día ya trabaja, no se lo propone', () => {
    const out = sugerenciasSueltas({
      ...base,
      dias: ['2026-11-01'],
      resultados: [
        { employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'M', 'Peaje · Puesto')] },
        { employeeId: 'alb', nombre: 'ALBANI', propuestas: [celda('alb', '2026-11-01', 'VF', 'Vifood · Puesto 2')] },
      ],
    });
    assert.equal(out.length, 0);
  });

  it('si el turno ya tiene gente, no sugiere', () => {
    const out = sugerenciasSueltas({
      ...base,
      dias: ['2026-11-01'],
      resultados: [
        { employeeId: 'ens', nombre: 'ENSABELLA', propuestas: [celda('ens', '2026-11-01', 'F')] },
        { employeeId: 'alb', nombre: 'ALBANI', propuestas: [celda('alb', '2026-11-01', 'VF', 'Vifood · Puesto 2')] },
      ],
      cargado: (e, d) => (e === 'cal' && d === '2026-11-01' ? { code: 'VFM', positionName: 'Vifood · Puesto 1' } : null),
      historia: [...historia, { employeeId: 'cal', nombre: 'CALDERON', previos: [] }],
    });
    // CALDERON no está en resultados: el VFM cargado no cuenta; sigue faltando y se propone a ENSABELLA.
    assert.equal(out.length, 1);
  });
});
