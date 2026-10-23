import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ServicePosition } from '@/services/slaService';
import { formatPositionDailyCoverageLabel, formatPositionPaxLabel } from './positionPaxLabel';

const diasLv = ['L', 'M', 'X', 'J', 'V'];

function museo(): ServicePosition {
  return {
    id: 'museo',
    name: 'Museo',
    coverageType: 'custom',
    quantity: 1,
    activeDays: diasLv,
    allowedShiftTypes: [
      { code: 'MM', name: 'MM', startTime: '08:00', endTime: '17:00', hours: 9, quantity: 3, days: diasLv },
      { code: 'ME', name: 'ME', startTime: '07:00', endTime: '19:00', hours: 12, days: diasLv },
    ],
  };
}

describe('etiqueta de puesto', () => {
  it('Museo suma el PAX efectivo de cada franja: 4 PAX y 39 hs/día L–V', () => {
    const pos = museo();
    assert.equal(formatPositionPaxLabel(pos), '4 PAX');
    assert.equal(formatPositionDailyCoverageLabel(pos), '39 hs/día · L–V');
  });

  it('24 h con la misma cantidad por banda sigue en ese PAX, no en la suma de M+T+N', () => {
    const pos: ServicePosition = {
      id: 'guardia',
      name: 'Guardia',
      coverageType: '24hs',
      quantity: 2,
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      allowedShiftTypes: [
        { code: 'M', name: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 2 },
        { code: 'T', name: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 2 },
        { code: 'N', name: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 2 },
        { code: 'D12', name: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
        { code: 'N12', name: 'N12', startTime: '19:00', endTime: '07:00', hours: 12 },
      ],
    };
    assert.equal(formatPositionPaxLabel(pos), '2 PAX');
    assert.equal(formatPositionDailyCoverageLabel(pos), '48 hs/día');
  });
});
