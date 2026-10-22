import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isArgentineHoliday } from '../servicios/slaHoursCalculator';
import {
  feriadoCuentaParaEmpresa,
  mapArgentinaDatos,
  mapNolaborables,
} from './feriadosGov';

describe('mapArgentinaDatos', () => {
  it('lee fecha, nombre y tipo', () => {
    const rows = mapArgentinaDatos([
      { fecha: '2027-01-01', tipo: 'inamovible', nombre: 'Año nuevo' },
      { fecha: '2027-06-17', tipo: 'trasladable', nombre: 'Güemes' },
      { fecha: '2027-03-23', tipo: 'puente', nombre: 'Puente turístico no laborable' },
      { fecha: '2027-06-17', tipo: 'trasladable', nombre: 'duplicado' },
      { fecha: 'no-es-fecha', tipo: 'inamovible', nombre: 'Basura' },
      { nombre: 'Sin fecha' },
    ]);
    assert.deepEqual(rows, [
      { date: '2027-01-01', name: 'Año nuevo', type: 'Nacional' },
      { date: '2027-06-17', name: 'Güemes', type: 'Nacional' },
      { date: '2027-03-23', name: 'Puente turístico no laborable', type: 'Puente' },
    ]);
  });

  it('ignora un payload que no es lista', () => {
    assert.deepEqual(mapArgentinaDatos({ fecha: '2027-01-01' }), []);
    assert.deepEqual(mapArgentinaDatos(null), []);
  });
});

describe('mapNolaborables', () => {
  it('arma la fecha con mes, dia y el año consultado', () => {
    const rows = mapNolaborables([
      { mes: 1, dia: 1, motivo: 'Año Nuevo', tipo: 'inamovible' },
      { mes: 2, dia: 8, motivo: 'Carnaval' },
      { mes: 11, dia: 9, motivo: 'Optativo local', tipo: 'optativo' },
      { mes: 2, dia: 8, motivo: 'Carnaval repetido' },
      { mes: 13, dia: 1, motivo: 'Mes inválido' },
      { dia: 1, motivo: 'Sin mes' },
    ], 2027);
    assert.deepEqual(rows, [
      { date: '2027-01-01', name: 'Año Nuevo', type: 'Nacional' },
      { date: '2027-02-08', name: 'Carnaval', type: 'Nacional' },
      { date: '2027-11-09', name: 'Optativo local', type: 'Optativo' },
    ]);
  });
});

describe('feriadoCuentaParaEmpresa', () => {
  it('no toma la fecha de otra empresa y sí la global o la propia', () => {
    assert.equal(feriadoCuentaParaEmpresa('empresa-a', 'empresa-a'), true);
    assert.equal(feriadoCuentaParaEmpresa('empresa-b', 'empresa-a'), false);
    assert.equal(feriadoCuentaParaEmpresa('', 'empresa-a'), true);
    assert.equal(feriadoCuentaParaEmpresa(undefined, 'empresa-a'), true);
    assert.equal(feriadoCuentaParaEmpresa('empresa-a', undefined), false);
    assert.equal(feriadoCuentaParaEmpresa('', ''), true);
  });
});

describe('lista fija 2027', () => {
  it('coincide con argentinadatos en los móviles y no conserva las fechas viejas', () => {
    for (const fecha of [
      '2027-01-01',
      '2027-02-08',
      '2027-02-09',
      '2027-03-24',
      '2027-03-26',
      '2027-04-02',
      '2027-05-01',
      '2027-05-25',
      '2027-06-17',
      '2027-06-20',
      '2027-07-09',
      '2027-08-17',
      '2027-10-12',
      '2027-11-20',
      '2027-12-08',
      '2027-12-25',
    ]) {
      assert.equal(isArgentineHoliday(fecha), true, fecha);
    }
    for (const vieja of ['2027-02-01', '2027-02-02', '2027-08-16', '2027-10-11', '2027-11-22']) {
      assert.equal(isArgentineHoliday(vieja), false, vieja);
    }
  });
});
