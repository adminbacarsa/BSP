import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRefuerzoHorasVendidasToBreakdown } from './refuerzoProforma';

test('prefactura: el refuerzo eventual va en una línea por sigla y horario, con las horas de cada día', () => {
  const base = { estado: 'ASIGNADA', tipo: 'REFUERZO_PUESTO', alcance: 'PUNTUAL', objectiveName: 'Casino Carlos Paz', positionName: 'Refuerzo eventual', shiftCode: 'RFZE', rfzSigla: 'RM', startTime: '08:00', endTime: '16:00', cantidadPax: 1 };
  const target = { total: 0, byObjective: {} as any };
  const sols = [{ ...base, id: 'a', fecha: '2026-10-20' }, { ...base, id: 'b', fecha: '2026-10-21' }] as any[];
  const n = applyRefuerzoHorasVendidasToBreakdown(target, sols, { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31) }, (x) => x.toLowerCase());
  assert.equal(n, 16);
  const pos = Object.values((Object.values(target.byObjective)[0] as any).positions)[0] as any;
  assert.equal(pos.positionName, 'RFZE · RM · 08:00–16:00');
  assert.deepEqual(pos.byDay, { '2026-10-20': 8, '2026-10-21': 8 });
});
