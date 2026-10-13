import assert from 'node:assert/strict';
import test from 'node:test';
import { cuilCheckDigit } from '@/lib/eventuales/cuil.mjs';
import type { FilaPadron } from '@/lib/planificacion/padronAlta';
import { planAltaMasiva, resumenAltaMasiva } from '@/lib/planificacion/altaMasiva';

const CTX = { empresaId: 'bacarsa', objectiveId: 'obj_vm', clientId: 'cli_vm' };

function fila(legajo: string, apellido: string, nombre: string, dni: string, estado = 'Activo'): FilaPadron {
  const base = `20${dni}`;
  return {
    legajo, apellido, nombre, dni, cuil: base + cuilCheckDigit(base), mail: '', telefono: '', domicilio: '',
    tipo: '', area: '', puesto: 'VIGILADOR', objetivo: '', nacimiento: '', genero: '', ingreso: '', estado, ultimaActividad: '',
  };
}

const PADRON = [
  fila('1001', 'PEREZ', 'JUAN CARLOS', '30111222'),
  fila('1002', 'GOMEZ', 'ANA', '30111333'),
  fila('1003', 'LOPEZ', 'MARIO', '30111444', 'Baja'),
];

test('alta masiva: legajo y nombre exactos se dan de alta; el resto queda para revisar', () => {
  const plan = planAltaMasiva(PADRON, [
    { clave: 0, nombre: 'PEREZ, JUAN CARLOS', legajo: '' },
    { clave: 1, nombre: 'X', legajo: '1002' },
    { clave: 2, nombre: 'LOPEZ, MARIO', legajo: '' },
    { clave: 3, nombre: 'FERNANDEZ, LUIS', legajo: '' },
  ], CTX);
  assert.equal(plan[0].tipo, 'alta');
  assert.equal(plan[0].tipo === 'alta' && plan[0].form.legajo, '1001');
  assert.equal(plan[0].tipo === 'alta' && plan[0].form.objectiveId, 'obj_vm');
  assert.equal(plan[1].tipo, 'alta');
  assert.equal(plan[1].tipo === 'alta' && plan[1].form.apellido, 'GOMEZ');
  assert.deepEqual(plan[2], { clave: 2, nombre: 'LOPEZ, MARIO', tipo: 'revisar', motivo: 'En el padrón figura «Baja»' });
  assert.deepEqual(plan[3], { clave: 3, nombre: 'FERNANDEZ, LUIS', tipo: 'revisar', motivo: 'No está en el padrón' });
});

test('alta masiva: la misma persona del padrón no se da de alta dos veces', () => {
  const plan = planAltaMasiva(PADRON, [
    { clave: 0, nombre: 'GOMEZ, ANA', legajo: '' },
    { clave: 1, nombre: 'GOMEZ ANA', legajo: '1002' },
  ], CTX);
  assert.equal(plan[0].tipo, 'alta');
  assert.equal(plan[1].tipo, 'revisar');
});

test('alta masiva: resumen en palabras', () => {
  assert.equal(resumenAltaMasiva([
    { clave: 0, nombre: 'a', estado: 'creado' },
    { clave: 1, nombre: 'b', estado: 'creado' },
    { clave: 2, nombre: 'c', estado: 'habilitado' },
    { clave: 3, nombre: 'd', estado: 'revisar', motivo: 'x' },
  ]), '2 dados de alta · 1 habilitado desde otra empresa · 1 para revisar');
  assert.equal(resumenAltaMasiva([]), 'Nada para dar de alta');
});
