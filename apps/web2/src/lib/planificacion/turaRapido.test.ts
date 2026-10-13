import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avisoJornadaTura, puestoAdmite12h, textoTura, tramoTura } from './turaRapido';

describe('TURA en el modo rápido', () => {
  it('solo un puesto de 24 HS (o que cubre el día) admite D12/N12', () => {
    assert.equal(puestoAdmite12h({ coverageType: '24hs', shifts: [] }), true);
    assert.equal(puestoAdmite12h({ coverageType: 'custom', shifts: [{ startTime: '07:00', endTime: '15:00' }, { startTime: '15:00', endTime: '23:00' }, { startTime: '23:00', endTime: '07:00' }] }), true);
    assert.equal(puestoAdmite12h({ coverageType: 'custom', shifts: [{ startTime: '07:00', endTime: '15:00' }] }), false);
    assert.equal(puestoAdmite12h(null), true);
  });
  it('el tramo va pegado antes o después del turno', () => {
    assert.deepEqual(tramoTura('07:00', '15:00', { lado: 'despues', horas: 2 }), { startTime: '15:00', endTime: '17:00' });
    assert.deepEqual(tramoTura('07:00', '15:00', { lado: 'antes', horas: 3 }), { startTime: '04:00', endTime: '07:00' });
    assert.deepEqual(tramoTura('23:00', '07:00', { lado: 'despues', horas: 1 }), { startTime: '07:00', endTime: '08:00' });
    assert.deepEqual(tramoTura('01:00', '07:00', { lado: 'antes', horas: 2 }), { startTime: '23:00', endTime: '01:00' });
    assert.equal(tramoTura('07:00', '15:00', { lado: 'antes', horas: 9 }), null);
  });
  it('avisa si la jornada pasa el tope y arma el texto', () => {
    assert.equal(avisoJornadaTura('07:00', '15:00', 4), '');
    assert.equal(avisoJornadaTura('07:00', '15:00', 5), 'La jornada queda en 13 h: pasa el tope de 12:59.');
    assert.equal(textoTura('M', '07:00', '15:00', { lado: 'despues', horas: 2 }), 'TURA 15:00–17:00 (2 h, después del M)');
  });
});
