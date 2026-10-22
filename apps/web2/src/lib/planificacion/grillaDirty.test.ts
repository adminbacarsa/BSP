import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alcanceDeClaves,
  aplicarPendientesEnSegundoBloque,
  aplicarPendientesEnTurnos,
  celdaEnAlcance,
  clavesDistintas,
  fusionarAlcance,
  mismosNumeros,
  mismosRefs,
  partirClaveGrilla,
} from './grillaDirty';

describe('grilla sucia', () => {
  it('parte la clave del legajo y la fecha, incluso con segundo bloque', () => {
    assert.deepEqual(partirClaveGrilla('abc_2026-10-22'), { empId: 'abc', dateStr: '2026-10-22' });
    assert.deepEqual(partirClaveGrilla('abc_2026-10-22_B2'), { empId: 'abc', dateStr: '2026-10-22' });
    assert.equal(partirClaveGrilla('corta'), null);
  });

  it('un Enter marca solo esa fila y esa columna', () => {
    const prev = { 'a_2026-10-01': { code: 'M' }, 'b_2026-10-02': { code: 'T' } };
    const m = prev['a_2026-10-01'];
    const t = prev['b_2026-10-02'];
    const next = { ...prev, 'a_2026-10-01': { code: 'N' } };
    const sucias = clavesDistintas(prev, next);
    assert.deepEqual(sucias, ['a_2026-10-01']);
    const alcance = alcanceDeClaves(sucias);
    assert.equal(celdaEnAlcance('a', '2026-10-03', alcance), true);
    assert.equal(celdaEnAlcance('b', '2026-10-01', alcance), true);
    assert.equal(celdaEnAlcance('b', '2026-10-02', alcance), false);
    assert.equal(next['b_2026-10-02'], t);
    assert.notEqual(next['a_2026-10-01'], m);
  });

  it('guardar aplica el borrador una sola vez y conserva el resto de turnos', () => {
    const viejo = { code: 'M' };
    const otro = { code: 'T' };
    const prev = { 'e1_2026-10-01': viejo, 'e2_2026-10-02': otro };
    const next = aplicarPendientesEnTurnos(prev, {
      'e1_2026-10-01': { code: 'N', isTemp: true },
      'e1_2026-10-01_B2': { code: 'X' },
      'e3_2026-10-03': { isDeleted: true },
    });
    assert.equal(next['e2_2026-10-02'], otro);
    assert.equal(next['e1_2026-10-01'].code, 'N');
    assert.equal(next['e1_2026-10-01'].isTemp, true);
    assert.equal(next['e1_2026-10-01_B2'].code, 'X');
    assert.deepEqual(mismosRefs([viejo, otro], [viejo, otro]), true);
    assert.deepEqual(mismosNumeros([8, 12], [8, 12]), true);
    assert.equal(fusionarAlcance([alcanceDeClaves(['e1_2026-10-01']), { empleados: new Set(), dias: new Set(), completo: true }]).completo, true);
  });

  it('el segundo bloque entra al mapa igual que el primero y un borrado lo saca', () => {
    const primario = { code: 'M' };
    const prev = {
      'e1_2026-10-01': primario,
      'e1_2026-10-02_B2': { code: 'N', startTime: '20:00', endTime: '08:00' },
    };
    const horario = { 'e1_2026-10-02': { startTime: '20:00', endTime: '08:00' } };
    const next = aplicarPendientesEnTurnos(prev, {
      'e1_2026-10-01_B2': { code: 'T', startTime: '14:00', endTime: '22:00', isSecondBlock: true },
      'e1_2026-10-02_B2': { isDeleted: true },
    });
    const bloques = aplicarPendientesEnSegundoBloque(horario, {
      'e1_2026-10-01_B2': { code: 'T', startTime: '14:00', endTime: '22:00', isSecondBlock: true },
      'e1_2026-10-02_B2': { isDeleted: true },
    });
    assert.equal(next['e1_2026-10-01'], primario);
    assert.equal(next['e1_2026-10-01_B2'].code, 'T');
    assert.equal(next['e1_2026-10-01_B2'].startTime, '14:00');
    assert.equal(next['e1_2026-10-01_B2'].endTime, '22:00');
    assert.equal('e1_2026-10-02_B2' in next, false);
    assert.deepEqual(bloques['e1_2026-10-01'], { startTime: '14:00', endTime: '22:00' });
    assert.equal('e1_2026-10-02' in bloques, false);
  });

  it('el borrador reemplaza extensión, retén, TURA y tramos: si no los trae, no se heredan', () => {
    const prev = {
      'e1_2026-10-01': {
        id: 'doc1',
        code: 'M',
        positionName: 'Puesto 1',
        isExtended: true,
        isReten: true,
        isEarlyStart: true,
        isTura: true,
        segmentFromTime: '18:00',
        segmentToTime: '22:00',
        adjustedStartTime: '05:00',
        adjustedEndTime: '20:00',
      },
    };
    const sinFlags = aplicarPendientesEnTurnos(prev, {
      'e1_2026-10-01': { code: 'T' },
    })['e1_2026-10-01'];
    assert.equal(sinFlags.id, 'doc1');
    assert.equal(sinFlags.code, 'T');
    assert.equal(sinFlags.positionName, 'Puesto 1');
    assert.equal('isExtended' in sinFlags, false);
    assert.equal('isReten' in sinFlags, false);
    assert.equal('isEarlyStart' in sinFlags, false);
    assert.equal('isTura' in sinFlags, false);
    assert.equal('segmentFromTime' in sinFlags, false);
    assert.equal('segmentToTime' in sinFlags, false);
    assert.equal('adjustedStartTime' in sinFlags, false);
    assert.equal('adjustedEndTime' in sinFlags, false);

    const conFlags = aplicarPendientesEnTurnos(prev, {
      'e1_2026-10-01': { code: 'M', isExtended: true, segmentFromTime: '19:00' },
    })['e1_2026-10-01'];
    assert.equal(conFlags.isExtended, true);
    assert.equal(conFlags.segmentFromTime, '19:00');
    assert.equal('isEarlyStart' in conFlags, false);
    assert.equal('isReten' in conFlags, false);
    assert.equal('adjustedStartTime' in conFlags, false);
    assert.equal('adjustedEndTime' in conFlags, false);

    const apagado = aplicarPendientesEnTurnos(prev, {
      'e1_2026-10-01': { code: 'M', isExtended: false },
    })['e1_2026-10-01'];
    assert.equal(apagado.isExtended, false);
  });
});
