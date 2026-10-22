/**
 * npx tsx --test src/servicios/copiarSlaMes.test.ts
 * Espejo de la decisión de web2: cliente ausente, endDate vacío e id fijo.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidirCopiaSlaMes, idCopiaSlaMes } from './copiarSlaMes.ts';

describe('copia SLA en Functions', () => {
  const octubre = {
    id: 'oct',
    objectiveId: 'obj-claret',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    status: 'active',
    positions: [],
  };

  it('sin endDate ya cubre el mes y un cliente null no se copia', () => {
    const abierto = { ...octubre, id: 'ab', endDate: '' };
    assert.equal(decidirCopiaSlaMes([abierto], '2026-11', { cliente: { status: 'ACTIVE' } }).accion, 'existe');
    const ausente = decidirCopiaSlaMes([octubre], '2026-11', { cliente: null });
    assert.equal(ausente.accion, 'omitir');
    if (ausente.accion === 'omitir') assert.equal(ausente.motivo, 'cliente_inactivo');
    assert.equal(decidirCopiaSlaMes([octubre], '2026-11').accion, 'crear');
    assert.equal(idCopiaSlaMes('obj-claret', '2026-11'), 'sla_obj-claret_2026-11');
  });
});
