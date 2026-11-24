/**
 * npx tsx --test src/fichajes/applyPortalCheckOut.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluarRelevoSalida } from './applyPortalCheckOut.ts';

describe('evaluarRelevoSalida', () => {
  const saliente = { positionName: 'Contado', code: 'C0', employeeId: 'allasia' };

  it('C0 y C1 del mismo puesto no son relevo: no es serie 24 h', () => {
    const estado = evaluarRelevoSalida(saliente, 'saliente', 'allasia', [
      { id: 'acuna', data: { positionName: 'Contado', code: 'C1', employeeId: 'acuna', status: 'PENDING' } },
    ]);
    assert.deepEqual(estado, { programado: false, presente: false });
  });

  it('M espera a T del mismo puesto aunque todavía no haya llegado', () => {
    const estado = evaluarRelevoSalida(
      { positionName: 'Puesto 1', code: 'M', employeeId: 'a' },
      'saliente',
      'a',
      [{ id: 'b', data: { positionName: 'Puesto 1', code: 'T', employeeId: 'b', status: 'PENDING' } }],
    );
    assert.deepEqual(estado, { programado: true, presente: false });
  });

  it('T presente cierra al saliente M', () => {
    const estado = evaluarRelevoSalida(
      { positionName: 'Puesto 1', code: 'M', employeeId: 'a' },
      'saliente',
      'a',
      [{ id: 'b', data: { positionName: 'Puesto 1', code: 'T', employeeId: 'b', status: 'PRESENT', isPresent: true } }],
    );
    assert.deepEqual(estado, { programado: true, presente: true });
  });

  it('D12 espera a N12 y no a otro D12', () => {
    const base = { positionName: 'Puesto 1', employeeId: 'b', status: 'PENDING' };
    assert.equal(
      evaluarRelevoSalida({ positionName: 'Puesto 1', code: 'D12' }, 's', 'a', [
        { id: 'b', data: { ...base, code: 'N12' } },
      ]).programado,
      true,
    );
    assert.equal(
      evaluarRelevoSalida({ positionName: 'Puesto 1', code: 'D12' }, 's', 'a', [
        { id: 'b', data: { ...base, code: 'D12' } },
      ]).programado,
      false,
    );
  });
});
