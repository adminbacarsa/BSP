import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coberturaPorHoras, textoHoras } from './coberturaHoras';

const P1 = { positionName: 'Puesto 1', franjas: [{ code: 'P1M', startTime: '08:00', endTime: '16:00', qty: 1 }] };
const P2 = { positionName: 'Puesto 2', franjas: [
  { code: 'M', startTime: '07:00', endTime: '15:00', qty: 1 },
  { code: 'T', startTime: '15:00', endTime: '23:00', qty: 1 },
  { code: 'N', startTime: '23:00', endTime: '07:00', qty: 1 },
  { code: 'D12', startTime: '07:00', endTime: '19:00', qty: 1 },
  { code: 'N12', startTime: '19:00', endTime: '07:00', qty: 1 },
] };
const P3 = { positionName: 'Puesto 3', franjas: [
  { code: 'M', startTime: '07:00', endTime: '15:00', qty: 1 },
  { code: 'T', startTime: '15:00', endTime: '23:00', qty: 1 },
] };

describe('doble control: cobertura por horas', () => {
  it('48 h pedidas: P1M + D12/N12 + una persona 16 h cierran por horas', () => {
    const r = coberturaPorHoras([P1, P2, P3], [
      { positionName: 'Puesto 1', startTime: '08:00', endTime: '16:00' },
      { positionName: 'Puesto 2', startTime: '07:00', endTime: '19:00' },
      { positionName: 'Puesto 2', startTime: '19:00', endTime: '07:00' },
      { positionName: 'Puesto 3', startTime: '07:00', endTime: '23:00' },
    ]);
    assert.equal(r.requeridas, 48);
    assert.equal(r.cubiertas, 48);
    assert.equal(r.cerrado, true);
    assert.equal(textoHoras(r), 'Horas 48/48: cerrado por horas');
  });
  it('14 h en Puesto 3: faltan 2 h y dice dónde', () => {
    const r = coberturaPorHoras([P1, P2, P3], [
      { positionName: 'Puesto 1', startTime: '08:00', endTime: '16:00' },
      { positionName: 'Puesto 2', startTime: '07:00', endTime: '19:00' },
      { positionName: 'Puesto 2', startTime: '19:00', endTime: '07:00' },
      { positionName: 'Puesto 3', startTime: '07:00', endTime: '21:00' },
    ]);
    assert.equal(r.cerrado, false);
    assert.equal(textoHoras(r), 'Horas 46/48 · falta 2 h en Puesto 3 (21:00–23:00)');
  });
  it('lo que sobra en una ventana no tapa otra', () => {
    const r = coberturaPorHoras([P3], [
      { positionName: 'Puesto 3', startTime: '07:00', endTime: '15:00' },
      { positionName: 'Puesto 3', startTime: '07:00', endTime: '15:00' },
    ]);
    assert.equal(r.faltan, 8);
  });
});
