import { describe, expect, it } from 'vitest';
import { stampHoursBalanceRowsForWrite } from './hoursBalanceWriter';
import type { HoursBalanceRow } from './types';

const baseRow: HoursBalanceRow = {
  empresaId: 'emp1',
  objectiveId: 'obj1',
  objectiveName: 'Obj',
  clientId: 'c1',
  clientName: 'Cliente',
  year: 2026,
  month: 9,
  periodKey: '2026-09',
  slaHours: 100,
  plannedHours: 80,
  vacantHours: 0,
  realHours: 70,
  ftHours: 0,
  extHours: 0,
  adelHours: 0,
  opsHours: 0,
  absenceHours: 0,
  resultante: 80,
  saldoPlan: 20,
  saldoReal: 30,
  rebuiltFrom: 'crm-bootstrap',
};

describe('stampHoursBalanceRowsForWrite', () => {
  it('marca canal planning y fuente analisis según meta', () => {
    const [row] = stampHoursBalanceRowsForWrite([baseRow], { channel: 'planning', actor: 'test@bacar' });
    expect(row.rebuiltFrom).toBe('planning');
    expect(row.writeChannel).toBe('planning');
    expect(row.writtenBy).toBe('test@bacar');
    expect(row.computedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('mapea analisis_refresh a rebuiltFrom analisis', () => {
    const [row] = stampHoursBalanceRowsForWrite([baseRow], { channel: 'analisis_refresh' });
    expect(row.rebuiltFrom).toBe('analisis');
    expect(row.writeChannel).toBe('analisis_refresh');
  });
});
