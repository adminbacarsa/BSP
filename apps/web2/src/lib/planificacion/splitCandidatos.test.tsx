import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEarlyStartCandidates, listExtensionCandidates } from './planningRecompositionApply';

const OBJ = 'obj1';
const DIA = '2026-10-01';
const turnos: Array<[string, string, string]> = [
  ['galeano', 'M', 'Guardia'],
  ['perez', 'M', 'Playa'],
  ['sosa', 'M', 'Proveedores'],
  ['ross', 'T', 'Guardia'],
  ['barros', 'N', 'Playa'],
  ['gomez', 'N', 'Guardia'],
];
const employees = turnos.map(([id]) => ({ id, name: id.toUpperCase() }));
const shiftsMap: Record<string, any> = {};
for (const [id, code, positionName] of turnos) {
  shiftsMap[`${id}_${DIA}`] = { employeeId: id, objectiveId: OBJ, code, positionName };
}
const ctx = { gapPositionName: 'Guardia', preferSamePosition: true };

test('extensión ofrece todos los M del objetivo, el del mismo puesto primero', () => {
  const rows = listExtensionCandidates('T', DIA, OBJ, employees, shiftsMap, {}, ['ross'], ctx);
  assert.deepEqual(rows.map((r) => r.id), ['galeano', 'perez', 'sosa']);
});

test('adelanto ofrece todos los N del objetivo, el del mismo puesto primero', () => {
  const rows = listEarlyStartCandidates('T', DIA, OBJ, employees, shiftsMap, {}, ['ross'], ctx);
  assert.deepEqual(rows.map((r) => r.id), ['gomez', 'barros']);
});
