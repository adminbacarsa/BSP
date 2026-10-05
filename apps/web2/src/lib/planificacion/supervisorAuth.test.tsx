import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clasificarPedidosPin,
  topeRequierePin,
  type TopeAutorizacion,
} from '@/lib/planificacion/supervisorAuth';

const grant = (over: Partial<TopeAutorizacion> = {}): TopeAutorizacion => ({
  empleadoId: 'e1',
  periodo: '2026-10',
  autorizadoPor: 'Ana Supervisor',
  motivo: 'cobertura de licencia',
  fecha: '2026-10-05T14:00:00.000Z',
  horasAlAutorizar: 204,
  status: 'ACTIVE',
  ...over,
});

test('la primera asignación sobre 200 h pide PIN', () => {
  const r = clasificarPedidosPin(
    [{ kind: 'TOPE', employeeId: 'e1', dateStr: '2026-10-15' }],
    () => null,
  );
  assert.equal(r.pedir.length, 1);
  assert.equal(r.pedir[0].kind, 'TOPE');
  assert.equal(r.avisos.length, 0);
});

test('la segunda asignación del mismo mes no pide PIN y avisa quién autorizó', () => {
  const g = grant();
  const r = clasificarPedidosPin(
    [{ kind: 'TOPE', employeeId: 'e1', dateStr: '2026-10-20' }],
    () => g,
  );
  assert.equal(r.pedir.length, 0);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /^Tope 200 h autorizado por Ana Supervisor el 05\/10 \(cobertura de licencia\)$/);
});

test('otro mes vuelve a pedir PIN', () => {
  const r = clasificarPedidosPin(
    [{ kind: 'TOPE', employeeId: 'e1', dateStr: '2026-11-02' }],
    () => grant(),
  );
  assert.equal(r.pedir.length, 1);
  assert.equal(r.avisos.length, 0);
});

test('revocar la autorización vuelve a pedir PIN', () => {
  const revocada = grant({ status: 'REVOKED' });
  assert.equal(topeRequierePin(revocada, '2026-10'), true);
  const r = clasificarPedidosPin(
    [{ kind: 'TOPE', employeeId: 'e1', dateStr: '2026-10-20' }],
    () => revocada,
  );
  assert.equal(r.pedir.length, 1);
  assert.equal(r.avisos.length, 0);
});

test('el descanso de 8 a 12 h pide PIN en cada turno aunque el tope del mes esté autorizado', () => {
  const r = clasificarPedidosPin(
    [
      { kind: 'DESCANSO', employeeId: 'e1', dateStr: '2026-10-20' },
      { kind: 'TOPE', employeeId: 'e1', dateStr: '2026-10-20' },
    ],
    () => grant(),
  );
  assert.equal(r.pedir.length, 1);
  assert.equal(r.pedir[0].kind, 'DESCANSO');
  assert.equal(r.avisos.length, 1);
});
