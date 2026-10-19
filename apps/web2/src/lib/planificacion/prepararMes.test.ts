import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elegirEstrategia, medirEstrategia, type EntradaUnidad, type Metricas } from './prepararMes';
import type { CeldaPropuesta } from './continuarMesAnterior';

const m = (p: Partial<Metricas>): Metricas => ({ horasPedidas: 100, horasSinCubrir: 0, diasConHueco: 0, doce: 0, horasAl50: 0, ret: 0, cambios: 0, guardiasUsados: 1, horasMin: 0, horasMax: 0, propuestas: 0, ...p });

test('elegir: gana la que deja menos horas sin cubrir (más de 4 h de diferencia)', () => {
  assert.equal(elegirEstrategia(m({ horasSinCubrir: 48 }), m({ horasSinCubrir: 0 })).recomendada, 'armar');
  assert.equal(elegirEstrategia(m({ horasSinCubrir: 2, doce: 0 }), m({ horasSinCubrir: 0, doce: 3 })).recomendada, 'continuar');
});

test('elegir: después las horas al 50 % y las 12 h; si empatan, la copia', () => {
  assert.equal(elegirEstrategia(m({ horasAl50: 10 }), m({ horasAl50: 0 })).recomendada, 'armar');
  assert.equal(elegirEstrategia(m({ doce: 0 }), m({ doce: 4 })).recomendada, 'continuar');
  assert.equal(elegirEstrategia(m({}), m({})).recomendada, 'continuar');
});

test('medir: horas sin cubrir por puesto y día, 12 h, RET y horas al 50 %', () => {
  const dias = ['2026-11-02', '2026-11-03'];
  const input: EntradaUnidad = {
    unidadId: 'o1',
    dias,
    estructura: [{ positionName: 'P1', qty: 1, shifts: [{ code: 'M', startTime: '07:00', endTime: '15:00' }, { code: 'T', startTime: '15:00', endTime: '23:00' }] } as any],
    guardias: [{ id: 'a', nombre: 'A', previos: [], tipo: 'propio' }, { id: 'b', nombre: 'B', previos: [], tipo: 'propio' }],
    salientes: [],
    licencia: () => false,
    turnoDelMes: () => null,
    horasFueraDe: (id) => (id === 'a' ? 195 : 0),
    retFuera: () => [],
    diaBloqueado: () => false,
    turnoHabilitado: () => true,
  };
  const c = (employeeId: string, dateStr: string, code: string, hours: number, isFranco = false): CeldaPropuesta => ({ employeeId, dateStr, code, name: code, positionName: 'P1', startTime: '07:00', endTime: '15:00', hours, isFranco });
  const r = medirEstrategia(input, [c('a', '2026-11-02', 'M', 8), c('b', '2026-11-02', 'T', 8), c('a', '2026-11-03', 'D12', 12), c('b', '2026-11-03', 'RET', 0)]);
  assert.equal(r.horasPedidas, 32);
  assert.equal(r.horasSinCubrir, 4);
  assert.equal(r.diasConHueco, 1);
  assert.equal(r.doce, 1);
  assert.equal(r.ret, 1);
  assert.equal(r.horasAl50, 15);
});
