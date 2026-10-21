import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyBreakdown, horasDelMesDestino } from '../servicios/slaHoursCalculator';

/** 1 puesto × 8 h, todos los días (como el SLA de un mes copiado). */
const puesto8h = [{
  name: 'Puesto 1',
  quantity: 1,
  coverageType: 'custom' as const,
  status: 'ACTIVE',
  activeDays: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
  allowedShiftTypes: [{ code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 }],
}];

test('horas del mes destino: noviembre 2026 con 1×8 h diario es 240, no la suma con octubre', () => {
  const noviembre = horasDelMesDestino(puesto8h as any, '2026-11-01', '2026-11-30');
  const suma = Math.round(
    calculateMonthlyBreakdown(puesto8h as any, '2026-10-01', '2026-11-30').reduce((acc, m) => acc + m.totalHours, 0),
  );
  assert.equal(noviembre, 240);
  assert.equal(suma, 488);
  assert.notEqual(noviembre, suma);
});
