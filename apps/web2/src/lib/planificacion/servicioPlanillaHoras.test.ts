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

test('−F descuenta el feriado: guardia 8 h de octubre 2026 son 240 h, no 248', () => {
  const f = (sinFeriado: boolean) => ({
    puesto: 'Guardia', code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: [],
    ...(sinFeriado ? { trabajaFeriados: false } : {}),
  }) as any;
  assert.equal(horasMesDeFranjas([f(false)], 2026, 10), 248);
  assert.equal(horasMesDeFranjas([f(true)], 2026, 10), 240);
});
