import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elegirEstrategia, medirEstrategia, type EntradaUnidad, type Metricas } from './prepararMes';
import type { CeldaPropuesta } from './continuarMesAnterior';
import { objetivoPublicado, TEXTO_SIN_VERIFICAR_PUBLICACION } from './objetivoPublicado';
import {
  aplicarPropuestasPreparar,
  correrTanda,
  DESDE_PREPARAR,
  leerObjetivosPublicados,
  quitarBorradorPrepararPublicado,
  unidadesDelMes,
} from './prepararMesTanda';

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

const puestoMes = (objectiveId: string) => ({
  id: `sla-${objectiveId}`,
  clientId: 'c1',
  objectiveId,
  status: 'active',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  positions: [{
    positionName: 'Puesto',
    qty: 1,
    coverageType: 'custom',
    activeDays: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
    shifts: [{ code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 }],
  }],
});

test('tanda: grupo con un objetivo publicado solo propone para el otro', async () => {
  const clients = [{
    id: 'c1',
    name: 'Cliente',
    status: 'ACTIVE',
    objetivos: [
      { id: 'obj-pub', name: 'Peaje', status: 'ACTIVE' },
      { id: 'obj-abierto', name: 'Vifood', status: 'ACTIVE' },
    ],
  }];
  const unidades = unidadesDelMes(clients, [{ id: 'g1', nombre: 'Peaje + Vifood', objectiveIds: ['obj-pub', 'obj-abierto'] }]);
  assert.equal(unidades.length, 1);
  assert.equal(unidades[0].grupo, true);
  const filas = await correrTanda({
    unidades,
    year: 2026,
    month: 10,
    modo: 'armar',
    allSla: [puestoMes('obj-pub'), puestoMes('obj-abierto')],
    clients,
    employees: [{ id: 'g2', name: 'Gomez', status: 'activo', preferredObjectiveId: 'obj-abierto' }],
    slaIdToObjId: {},
    shiftsMap: {
      'g2_2026-11-02': { objectiveId: 'obj-pub', code: 'M', hours: 8, positionName: 'Puesto', employeeName: 'Gomez' },
    },
    absencesMap: {},
    historia: async () => [],
    publicado: async (oid) => oid === 'obj-pub',
  });
  assert.equal(filas.length, 1);
  const fila = filas[0];
  assert.equal(fila.estado, 'ok');
  assert.ok(fila.notas.includes('parte del grupo ya publicada'));
  const celdas = fila.celdas || [];
  const trabajo = celdas.filter((c) => !c.isFranco && c.code !== 'F' && c.positionName !== 'General');
  assert.ok(trabajo.length > 0);
  assert.ok((fila.armar?.horasPedidas || 0) > 0);
  assert.ok((fila.armar?.horasPedidas || 0) < 300, `pidió ${fila.armar?.horasPedidas}: entró el objetivo publicado`);
  for (const c of celdas) {
    assert.equal(String(c.positionName).includes('Peaje'), false, c.positionName);
    assert.equal(c.employeeId === 'g2' && c.dateStr === '2026-11-02', false);
  }
  for (const c of trabajo) assert.equal(c.positionName.startsWith('Vifood · '), true, c.positionName);
});

test('tanda: si no queda ningún objetivo sin publicar, el grupo queda publicado', async () => {
  const clients = [{
    id: 'c1',
    name: 'Cliente',
    status: 'ACTIVE',
    objetivos: [
      { id: 'obj-pub', name: 'Peaje', status: 'ACTIVE' },
      { id: 'obj-abierto', name: 'Vifood', status: 'ACTIVE' },
    ],
  }];
  const unidades = unidadesDelMes(clients, [{ id: 'g1', nombre: 'Grupo', objectiveIds: ['obj-pub', 'obj-abierto'] }]);
  const filas = await correrTanda({
    unidades,
    year: 2026,
    month: 10,
    modo: 'armar',
    allSla: [puestoMes('obj-pub'), puestoMes('obj-abierto')],
    clients,
    employees: [{ id: 'g2', name: 'Gomez', status: 'activo', preferredObjectiveId: 'obj-abierto' }],
    slaIdToObjId: {},
    shiftsMap: {},
    absencesMap: {},
    historia: async () => [],
    publicado: async () => true,
  });
  assert.equal(filas[0].estado, 'publicado');
  assert.equal(filas[0].celdas, undefined);
});

test('objetivoPublicado sigue al legacy cuando el tenant no tiene publishedAt', async () => {
  const vistos: string[] = [];
  const publicado = await objetivoPublicado('bacar', 'obj1', 2026, 11, async (id) => {
    vistos.push(id);
    if (id === 'bacar_obj1_2026_11') return { publishedAt: undefined };
    if (id === 'obj1_2026_11') return { publishedAt: '2026-11-02T00:00:00.000Z', publishedBy: 'ana' };
    return null;
  });
  assert.equal(publicado, true);
  assert.deepEqual(vistos, ['bacar_obj1_2026_11', 'obj1_2026_11']);

  const abierto = await objetivoPublicado('bacar', 'obj1', 2026, 11, async (id) => (
    id === 'bacar_obj1_2026_11' ? { publishedAt: '' } : null
  ));
  assert.equal(abierto, false);

  const tenantManda = await objetivoPublicado('bacar', 'obj1', 2026, 11, async (id) => (
    id === 'bacar_obj1_2026_11' ? { publishedAt: '2026-11-01T00:00:00.000Z' } : null
  ));
  assert.equal(tenantManda, true);
});

test('tanda: si no se puede leer la publicación, no se arma ni queda completo', async () => {
  const clients = [{
    id: 'c1',
    name: 'Cliente',
    status: 'ACTIVE',
    objetivos: [{ id: 'obj-abierto', name: 'Vifood', status: 'ACTIVE' }],
  }];
  const unidades = unidadesDelMes(clients, []);
  let armo = false;
  const filas = await correrTanda({
    unidades,
    year: 2026,
    month: 10,
    modo: 'armar',
    allSla: [puestoMes('obj-abierto')],
    clients,
    employees: [{ id: 'g2', name: 'Gomez', status: 'activo', preferredObjectiveId: 'obj-abierto' }],
    slaIdToObjId: {},
    shiftsMap: {},
    absencesMap: {},
    historia: async () => { armo = true; return []; },
    publicado: async () => { throw new Error('red'); },
  });
  assert.equal(filas[0].estado, 'sin_verificar');
  assert.equal(filas[0].celdas, undefined);
  assert.equal(armo, false);
  assert.ok(filas[0].notas.includes(TEXTO_SIN_VERIFICAR_PUBLICACION));
});

test('aplicar Preparar no toca celdas del objetivo publicado; la corrección manual sí se guarda', async () => {
  const manual = { objectiveId: 'obj-pub', code: 'M' };
  const aplicado = aplicarPropuestasPreparar(
    { 'g2_2026-11-02': manual },
    [
      { key: 'g2_2026-11-02', objectiveId: 'obj-pub', code: 'N' },
      { key: 'g2_2026-11-03', objectiveId: 'obj-pub', code: 'T' },
      { key: 'g2_2026-11-04', objectiveId: 'obj-abierto', code: 'M' },
    ],
    new Set(['obj-pub']),
  );
  assert.equal(aplicado.borrador['g2_2026-11-02'], manual);
  assert.equal(aplicado.borrador['g2_2026-11-03'], undefined);
  assert.equal(aplicado.borrador['g2_2026-11-04'].code, 'M');
  assert.equal(aplicado.borrador['g2_2026-11-04'][DESDE_PREPARAR], true);
  assert.deepEqual(aplicado.bloqueados, ['obj-pub']);

  const lectura = await leerObjetivosPublicados(['obj-pub', 'obj-abierto', 'obj-roto'], async (oid) => {
    if (oid === 'obj-roto') throw new Error('red');
    return oid === 'obj-pub' ? { publishedAt: '2026-11-01T00:00:00.000Z' } : null;
  });
  assert.equal(lectura.publicados.has('obj-pub'), true);
  assert.equal(lectura.publicados.has('obj-abierto'), false);
  assert.equal(lectura.sinLeer.has('obj-roto'), true);

  const guardado = quitarBorradorPrepararPublicado({
    'g2_2026-11-02': manual,
    'g2_2026-11-03': { objectiveId: 'obj-pub', code: 'T', [DESDE_PREPARAR]: true },
    'g2_2026-11-04': { objectiveId: 'obj-abierto', code: 'M', [DESDE_PREPARAR]: true },
    'g2_2026-11-05': { objectiveId: 'obj-roto', code: 'M', [DESDE_PREPARAR]: true },
  }, lectura.publicados, lectura.sinLeer);
  assert.equal(guardado.pending['g2_2026-11-02'].code, 'M');
  assert.equal(guardado.pending['g2_2026-11-03'], undefined);
  assert.equal(guardado.pending['g2_2026-11-04'].code, 'M');
  assert.equal(guardado.pending['g2_2026-11-05'], undefined);
  assert.deepEqual(guardado.bloqueados, ['obj-pub']);
  assert.deepEqual(guardado.sinVerificar, ['obj-roto']);
});
