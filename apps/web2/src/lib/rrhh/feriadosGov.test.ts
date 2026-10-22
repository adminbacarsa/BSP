import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isArgentineHoliday } from '../servicios/slaHoursCalculator';
import {
  feriadoCuentaParaEmpresa,
  mapArgentinaDatos,
  mapNolaborables,
  trasladarFeriado,
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
      { date: '2027-06-21', name: 'Güemes (17/6)', type: 'Nacional' },
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

describe('traslado ley 27.399', () => {
  const semana: Array<[string, string, string]> = [
    ['2024-01-01', '2024-01-01', 'Lunes'],
    ['2024-01-02', '2024-01-01', 'Martes (2/1)'],
    ['2024-01-03', '2024-01-01', 'Miércoles (3/1)'],
    ['2024-01-04', '2024-01-08', 'Jueves (4/1)'],
    ['2024-01-05', '2024-01-08', 'Viernes (5/1)'],
    ['2024-01-06', '2024-01-06', 'Sábado'],
    ['2024-01-07', '2024-01-07', 'Domingo'],
  ];

  it('cubre cada día de la semana y no mueve una fecha ya trasladada', () => {
    for (const [ley, observada, nombre] of semana) {
      assert.equal(trasladarFeriado(ley), observada, ley);
      assert.equal(trasladarFeriado(observada), observada, observada);
      const [row] = mapArgentinaDatos([{ fecha: ley, tipo: 'trasladable', nombre: nombre.split(' (')[0] }]);
      assert.equal(row.date, observada);
      assert.equal(row.name, nombre);
    }
  });

  it('2026 ya viene trasladado: la fecha y el (d/m) de ley no cambian', () => {
    const rows = mapArgentinaDatos([
      { fecha: '2026-06-15', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del General Martín Güemes (17/6)' },
      { fecha: '2026-08-17', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del Gral. José de San Martín' },
      { fecha: '2026-10-12', tipo: 'trasladable', nombre: 'Día del Respeto a la Diversidad Cultural' },
      { fecha: '2026-11-23', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional (20/11)' },
    ]);
    assert.deepEqual(rows, [
      { date: '2026-06-15', name: 'Paso a la Inmortalidad del General Martín Güemes (17/6)', type: 'Nacional' },
      { date: '2026-08-17', name: 'Paso a la Inmortalidad del Gral. José de San Martín', type: 'Nacional' },
      { date: '2026-10-12', name: 'Día del Respeto a la Diversidad Cultural', type: 'Nacional' },
      { date: '2026-11-23', name: 'Día de la Soberanía Nacional (20/11)', type: 'Nacional' },
    ]);
  });

  it('2027 guarda el lunes observado y anota la fecha de ley', () => {
    const rows = mapArgentinaDatos([
      { fecha: '2027-06-17', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del General Martín Güemes' },
      { fecha: '2027-08-17', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del Gral. José de San Martín' },
      { fecha: '2027-10-12', tipo: 'trasladable', nombre: 'Día del Respeto a la Diversidad Cultural' },
      { fecha: '2027-11-20', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional' },
    ]);
    assert.deepEqual(rows, [
      { date: '2027-06-21', name: 'Paso a la Inmortalidad del General Martín Güemes (17/6)', type: 'Nacional' },
      { date: '2027-08-16', name: 'Paso a la Inmortalidad del Gral. José de San Martín (17/8)', type: 'Nacional' },
      { date: '2027-10-11', name: 'Día del Respeto a la Diversidad Cultural (12/10)', type: 'Nacional' },
      { date: '2027-11-20', name: 'Día de la Soberanía Nacional', type: 'Nacional' },
    ]);
  });
});

describe('lista fija 2027', () => {
  it('usa la fecha observada de los trasladables y no conserva la de ley ni las viejas', () => {
    for (const fecha of [
      '2027-01-01',
      '2027-02-08',
      '2027-02-09',
      '2027-03-24',
      '2027-03-26',
      '2027-04-02',
      '2027-05-01',
      '2027-05-25',
      '2027-06-20',
      '2027-06-21',
      '2027-07-09',
      '2027-08-16',
      '2027-10-11',
      '2027-11-20',
      '2027-12-08',
      '2027-12-25',
    ]) {
      assert.equal(isArgentineHoliday(fecha), true, fecha);
    }
    for (const vieja of ['2027-02-01', '2027-02-02', '2027-06-17', '2027-08-17', '2027-10-12', '2027-11-22']) {
      assert.equal(isArgentineHoliday(vieja), false, vieja);
    }
  });
});
