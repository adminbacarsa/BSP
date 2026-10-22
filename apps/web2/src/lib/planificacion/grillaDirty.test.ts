import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alcanceDeClaves,
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
    assert.equal('e1_2026-10-01_B2' in next, false);
    assert.deepEqual(mismosRefs([viejo, otro], [viejo, otro]), true);
    assert.deepEqual(mismosNumeros([8, 12], [8, 12]), true);
    assert.equal(fusionarAlcance([alcanceDeClaves(['e1_2026-10-01']), { empleados: new Set(), dias: new Set(), completo: true }]).completo, true);
  });
});
