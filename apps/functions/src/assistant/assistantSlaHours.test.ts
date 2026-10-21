/**
 * npx tsx --test src/assistant/assistantSlaHours.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slaHorasVendidasMesCalendario } from './assistantSlaHours.ts';

const DIA = '2026-10-05';

describe('horas vendidas con cantidad por banda', () => {
  it('1×M 2×T 2×N es 40 h el día, no 24 × 2', () => {
    const pos = {
      coverageType: 'custom',
      quantity: 2,
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 2 },
        { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 2 },
      ],
    };
    const r = slaHorasVendidasMesCalendario([pos], DIA, DIA, DIA);
    assert.equal(r.horas_vendidas_mes, 40);
  });

  it('24 h con quantity por turno igual sigue en 48', () => {
    const pos = {
      coverageType: '24hs',
      quantity: 2,
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 2 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 2 },
        { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 2 },
        { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
        { code: 'N12', startTime: '19:00', endTime: '07:00', hours: 12 },
      ],
    };
    const r = slaHorasVendidasMesCalendario([pos], DIA, DIA, DIA);
    assert.equal(r.horas_vendidas_mes, 48);
  });

  it('24 h sin quantity en el turno sigue multiplicando el PAX del puesto', () => {
    const pos = {
      coverageType: '24hs',
      quantity: 2,
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00' },
        { code: 'T', startTime: '15:00', endTime: '23:00' },
        { code: 'N', startTime: '23:00', endTime: '07:00' },
      ],
    };
    const r = slaHorasVendidasMesCalendario([pos], DIA, DIA, DIA);
    assert.equal(r.horas_vendidas_mes, 48);
  });
});
