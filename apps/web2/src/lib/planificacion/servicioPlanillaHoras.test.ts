import assert from 'node:assert/strict';
import { test } from 'node:test';
import { horasMesDeFranjas, posicionesDesdeFranjas } from './servicioDesdePlanilla';
test('Casino: horas del mes con fechas específicas y días del puesto escritos', () => {
  const fechas = Array.from({ length: 22 }, (_, i) => `2026-10-${String(10 + i).padStart(2, '0')}`);
  const f = (puesto: string, code: string, a: string, b: string, cantidad: number, extra: any = {}) => ({ puesto, code, startTime: a, endTime: b, cantidad, dias: [], ...extra }) as any;
  const franjas = [f('Guardia', 'M', '07:00', '15:00', 2), f('Guardia', 'T', '15:00', '23:00', 2), f('Guardia', 'N', '23:00', '07:00', 2), f('MM', 'M', '13:00', '21:00', 3), f('PP', 'T', '15:00', '22:00', 1, { fechas }), f('PP', 'N', '22:00', '05:00', 1, { fechas }), f('NN', 'N', '21:00', '05:00', 5)];
  assert.equal(horasMesDeFranjas(franjas, 2026, 10), 3780);
  const pos = posicionesDesdeFranjas(franjas);
  assert.deepEqual(pos.find((p: any) => p.name === 'Guardia')!.activeDays, ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  assert.ok(pos.find((p: any) => p.name === 'Guardia')!.allowedShiftTypes.some((t: any) => t.code === 'D12' && t.startTime === '07:00' && t.endTime === '19:00'));
});
