import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarObjetivosDePuesto,
  agruparAmbiguos,
  resolverObjetivoDelPuesto,
  turnoPuestoDeOtroObjetivoDelGrupo,
} from './puestoObjetivoGrupo';

const NINOS = 'SrbGWdNhgGhASc7keTBS';
const CASA = 'fwKK9liD19QHbyOHxi1V';

const grupo = [
  { id: NINOS, name: 'H. de Niños', puestos: ['Rondin', 'Playa', 'Internado', 'Guardia'] },
  { id: CASA, name: 'Casa Mc Donalds', puestos: ['Proveedores', 'Guardia'] },
];

test('Proveedores solo está en Casa: no se guarda en H. de Niños', () => {
  const decision = resolverObjetivoDelPuesto({
    positionName: 'Proveedores',
    objetivos: grupo,
    preferidoId: NINOS,
    respaldoId: NINOS,
  });
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.objectiveId, CASA);
    assert.equal(decision.motivo, 'unico');
  }
  const aplicado = aplicarObjetivosDePuesto({
    [`emp_${'2026-10-05'}`]: { positionName: 'Proveedores', objectiveId: NINOS, code: 'N' },
  }, {
    objetivos: grupo,
    preferidoDe: () => NINOS,
    objetivosDelMesDe: () => [NINOS],
  });
  assert.equal(aplicado.fuera.length, 0);
  assert.equal(aplicado.ambiguos.length, 0);
  assert.equal(aplicado.changes[`emp_2026-10-05`].objectiveId, CASA);
});

test('el puesto en los dos objetivos usa el preferido, si no el turno del mes, si no hay que elegir', () => {
  const preferido = resolverObjetivoDelPuesto({
    positionName: 'Guardia',
    objetivos: grupo,
    preferidoId: CASA,
  });
  assert.equal(preferido.ok && preferido.objectiveId, CASA);
  assert.equal(preferido.ok && preferido.motivo, 'preferido');

  const delMes = resolverObjetivoDelPuesto({
    positionName: 'Guardia',
    objetivos: grupo,
    preferidoId: 'afuera',
    objetivosDelMes: [NINOS, NINOS],
  });
  assert.equal(delMes.ok && delMes.objectiveId, NINOS);
  assert.equal(delMes.ok && delMes.motivo, 'turno-mes');

  const ambiguo = resolverObjetivoDelPuesto({
    positionName: 'Guardia',
    objetivos: grupo,
    preferidoId: '',
    objetivosDelMes: [NINOS, CASA],
  });
  assert.equal(ambiguo.ok, false);
  if (!ambiguo.ok && ambiguo.motivo === 'ambiguo') {
    assert.deepEqual(ambiguo.candidatos.map((c) => c.id), [NINOS, CASA]);
  }

  const elegido = resolverObjetivoDelPuesto({
    positionName: 'Guardia',
    objetivos: grupo,
    preferidoId: NINOS,
    elegidoId: CASA,
  });
  assert.equal(elegido.ok && elegido.objectiveId, CASA);
  assert.equal(elegido.ok && elegido.motivo, 'elegido');
});

test('un puesto que ningún SLA del grupo tiene no se guarda', () => {
  const decision = resolverObjetivoDelPuesto({
    positionName: 'Cochera',
    objetivos: grupo,
    preferidoId: NINOS,
    respaldoId: NINOS,
  });
  assert.deepEqual(decision, { ok: false, motivo: 'fuera', puesto: 'Cochera' });
  const aplicado = aplicarObjetivosDePuesto({
    'emp_2026-10-05': { positionName: 'Cochera', objectiveId: NINOS },
  }, {
    objetivos: grupo,
    preferidoDe: () => NINOS,
    objetivosDelMesDe: () => [],
  });
  assert.equal(aplicado.fuera.length, 1);
  assert.equal(aplicado.changes['emp_2026-10-05'].objectiveId, NINOS);
});

test('General no es un puesto del SLA y no pisa el objetivo', () => {
  const decision = resolverObjetivoDelPuesto({
    positionName: 'General',
    objetivos: grupo,
    respaldoId: NINOS,
  });
  assert.equal(decision.ok && decision.motivo, 'sin-puesto');
  const aplicado = aplicarObjetivosDePuesto({
    'emp_2026-10-05': { positionName: 'General', objectiveId: CASA },
  }, {
    objetivos: grupo,
    preferidoDe: () => NINOS,
    objetivosDelMesDe: () => [],
    respaldoDe: () => NINOS,
  });
  assert.equal(aplicado.changes['emp_2026-10-05'].objectiveId, CASA);
});

test('la lista de auditoría marca el puesto que está en el otro objetivo del grupo', () => {
  const mal = turnoPuestoDeOtroObjetivoDelGrupo({
    objectiveId: NINOS,
    positionName: 'Proveedores',
    objetivos: grupo,
  });
  assert.equal(mal?.otros[0].id, CASA);
  assert.equal(turnoPuestoDeOtroObjetivoDelGrupo({
    objectiveId: CASA,
    positionName: 'Proveedores',
    objetivos: grupo,
  }), null);
  assert.equal(turnoPuestoDeOtroObjetivoDelGrupo({
    objectiveId: NINOS,
    positionName: 'Playa',
    objetivos: grupo,
  }), null);
  const filas = agruparAmbiguos([
    { key: 'emp_2026-10-05', empId: 'emp', puesto: 'Guardia', candidatos: [], clave: 'emp|guardia' },
    { key: 'emp_2026-10-06', empId: 'emp', puesto: 'Guardia', candidatos: [], clave: 'emp|guardia' },
  ]);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].fechas, ['2026-10-05', '2026-10-06']);
});
