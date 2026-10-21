import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acreditarExtEntrePuestos, type PuestoExt } from './extEntrePuestos';
import { camposExtCobertura, horasExtraYaDelDia, siglaAgregado, validarCargaAgregado } from './extCoberturaRapido';

const dia24: PuestoExt[] = [
  { positionName: 'M', franjas: [{ code: 'M', startTime: '06:00', endTime: '14:00', qty: 1 }] },
  { positionName: 'T', franjas: [{ code: 'T', startTime: '14:00', endTime: '22:00', qty: 1 }] },
  { positionName: 'N', franjas: [{ code: 'N', startTime: '22:00', endTime: '06:00', qty: 1 }] },
];

const noche = [{ startTime: '22:00', endTime: '06:00' }];

describe('carga de extensión de cobertura', () => {
  it('la cobertura cierra el hueco y no suma sobre las horas vendidas', () => {
    const ext = camposExtCobertura('M', '06:00', '14:00', { lado: 'despues', horas: 4 });
    const adel = camposExtCobertura('N', '22:00', '06:00', { lado: 'antes', horas: 4 });
    assert.ok(ext && adel);
    assert.equal(ext.isTura, false);
    assert.equal(ext.isExtended, true);
    assert.equal(ext.segmentFromTime, '14:00');
    assert.equal(ext.segmentToTime, '18:00');
    assert.equal(adel.isEarlyStart, true);
    assert.equal(adel.segmentFromTime, '18:00');
    assert.equal(siglaAgregado(ext), 'EXT');
    assert.equal(siglaAgregado(adel), 'ADEL');
    const r = acreditarExtEntrePuestos(dia24, [
      { positionName: 'M', nombre: 'X', code: 'M', startTime: '06:00', endTime: '14:00', ...ext },
      { positionName: 'N', nombre: 'Y', code: 'N', startTime: '22:00', endTime: '06:00', ...adel },
    ]);
    const tarde = r.porPuesto.find((p) => p.positionName === 'T');
    assert.equal(tarde?.cerrado, true);
    assert.equal(tarde?.faltanHoras, 0);
    assert.equal(r.cerrado, true);
    assert.equal(r.vendidas, 24);
    assert.equal(r.facturable, r.vendidas);
    assert.equal(r.turaHoras, 0);
  });

  it('la TURA de las mismas horas se factura aparte', () => {
    const r = acreditarExtEntrePuestos(dia24, [
      { positionName: 'M', nombre: 'A', code: 'M', startTime: '06:00', endTime: '14:00' },
      { positionName: 'T', nombre: 'B', code: 'T', startTime: '14:00', endTime: '22:00' },
      { positionName: 'N', nombre: 'C', code: 'N', startTime: '22:00', endTime: '06:00' },
      { positionName: 'T', nombre: 'Cliente', code: 'TURA', isTura: true, startTime: '14:00', endTime: '18:00' },
    ]);
    assert.equal(siglaAgregado({ code: 'TURA', isTura: true }), 'TURA');
    assert.equal(r.cerrado, true);
    assert.equal(r.vendidas, 24);
    assert.equal(r.turaHoras, 4);
    assert.equal(r.facturable, r.vendidas + 4);
  });

  it('rechaza si la jornada pasa 12:59 h', () => {
    const msg = validarCargaAgregado({
      tipo: 'cobertura',
      inicio: '07:00',
      fin: '19:00',
      lado: 'despues',
      horas: 1,
    });
    assert.match(msg, /12:59/);
    assert.equal(validarCargaAgregado({
      tipo: 'tura',
      inicio: '07:00',
      fin: '15:00',
      lado: 'despues',
      horas: 4,
    }), '');
  });

  it('rechaza descanso menor a 8 h, el tope de 200 h, el cronograma bloqueado y la N', () => {
    assert.match(validarCargaAgregado({
      tipo: 'cobertura',
      inicio: '07:00',
      fin: '15:00',
      lado: 'antes',
      horas: 4,
      previo: { startTime: '15:00', endTime: '23:00' },
    }), /8 h/);
    assert.match(validarCargaAgregado({
      tipo: 'cobertura',
      inicio: '07:00',
      fin: '15:00',
      lado: 'despues',
      horas: 4,
      horasMes: 198,
    }), /200 h/);
    assert.match(validarCargaAgregado({
      tipo: 'cobertura',
      inicio: '07:00',
      fin: '15:00',
      lado: 'despues',
      horas: 2,
      bloqueado: true,
    }), /bloqueado/);
    assert.match(validarCargaAgregado({
      tipo: 'cobertura',
      inicio: '06:00',
      fin: '14:00',
      lado: 'antes',
      horas: 4,
      bandasNoche: noche,
    }), /La N no se cubre/);
    assert.equal(validarCargaAgregado({
      tipo: 'tura',
      inicio: '06:00',
      fin: '14:00',
      lado: 'antes',
      horas: 4,
      bandasNoche: noche,
    }), '');
  });

  it('reemplaza el extra ya contado del día y no frena al autorizado sobre 200 h', () => {
    const base = {
      tipo: 'cobertura' as const,
      inicio: '07:00',
      fin: '15:00',
      lado: 'despues' as const,
    };
    assert.equal(validarCargaAgregado({
      ...base,
      horas: 2,
      horasMes: 200,
      horasExtraYaContadas: 4,
    }), '');
    assert.match(validarCargaAgregado({
      ...base,
      horas: 2,
      horasMes: 200,
    }), /202 h/);
    assert.equal(validarCargaAgregado({
      ...base,
      horas: 4,
      horasMes: 210,
      topeAutorizado: true,
    }), '');
    assert.equal(validarCargaAgregado({
      ...base,
      horas: 4,
      horasMes: 199,
      diaEnCiclo: false,
    }), '');
  });

  it('el extra del día sale del borrador y, si no hay, de lo guardado', () => {
    const cuatro = { isExtended: true, extExtraHours: 4 };
    const dos = { isEarlyStart: true, extExtraHours: 2 };
    assert.equal(horasExtraYaDelDia(cuatro, dos), 4);
    assert.equal(horasExtraYaDelDia(null, dos), 2);
    assert.equal(horasExtraYaDelDia({ isDeleted: true, isExtended: true, extExtraHours: 9 }, dos), 2);
    assert.equal(horasExtraYaDelDia({ isExtended: false }, cuatro), 0);
    assert.equal(horasExtraYaDelDia(null, { isDeleted: true, isExtended: true, extExtraHours: 4 }), 0);
  });
});
