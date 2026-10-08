import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServiciosObjectiveCatalog } from './serviciosObjectiveCatalog';

const clients = [{ id: 'c1', name: 'Banco', status: 'ACTIVE', objetivos: [{ id: 'o1', name: 'Casa Matriz' }] }] as never;
const services = [{
  id: 's1', clientId: 'c1', clientName: 'Banco', objectiveId: 'o1', objectiveName: 'Casa Matriz',
  status: 'active', startDate: '2026-10-01', endDate: '2026-10-31', positions: [],
}] as never;

test('sin ningún cronograma publicado: con servicio, sin operación (no «en operación»)', () => {
  const [row] = buildServiciosObjectiveCatalog(clients, services, 2026, 9, { publishStatusMap: {} });
  assert.equal(row.hasSlaInMonth, false);
  assert.equal(row.hasServiceWithoutOperation, true);
});

test('con el cronograma del mes publicado: en operación', () => {
  const [row] = buildServiciosObjectiveCatalog(clients, services, 2026, 9, { publishStatusMap: { o1_2026_10: true } });
  assert.equal(row.hasSlaInMonth, true);
});
