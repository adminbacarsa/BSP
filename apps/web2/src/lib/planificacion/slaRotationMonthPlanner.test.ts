import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ServiceRotation } from '@/services/slaService';
import { billableHoursForContract } from '@/lib/crm/slaBilling';
import { getAllDatesInMonth } from './rotationUtils';
import { applyRotationsForMonth, rotationAdditionsToSlaRotationByDate } from './slaRotationMonthPlanner';
import { buildSlaRotationByDate } from './slaContractPlanning';

const FERIADO = '2026-10-12';
const LUNES = '2026-10-05';

function puesto(coverageType: string, sinFeriado: boolean) {
  return {
    positionName: 'Guardia',
    qty: 1,
    coverageType,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [{ code: 'M', hours: 8, startTime: '07:00', endTime: '15:00', days: ['L', 'M', 'X', 'J', 'V', 'S', 'D'] }],
    ...(sinFeriado ? { trabajaFeriados: false as const } : {}),
  };
}

function rotacion(cycle?: Pick<ServiceRotation, 'cycleMode' | 'cycleWorkDays' | 'cycleOffDays'>): ServiceRotation {
  return {
    id: 'r1',
    ...cycle,
    periods: [{
      label: 'Mes',
      trigger: { type: 'DATE_RANGE', fromDate: '2026-10-01', toDate: '2026-10-31' },
      entries: [{
        employeeId: 'e1',
        employeeName: 'A',
        positionName: 'Guardia',
        shiftCode: 'M',
        ...(cycle?.cycleMode === 'cycle_rotation' ? { cycleAnchorDate: FERIADO } : {}),
      }],
    }],
  };
}

function horasPlan(additions: ReturnType<typeof applyRotationsForMonth>): number {
  let total = 0;
  for (const cell of Object.values(additions)) {
    const code = String(cell.code || '').toUpperCase();
    if (code === 'F' || code === 'FF' || code === 'FP' || code === 'FT') continue;
    const stored = Number(cell.hours);
    total += stored >= 0.5 ? stored : 8;
  }
  return Math.round(total * 10) / 10;
}

function facturaPlan(horas: number): number {
  return billableHoursForContract({
    mode: 'PLANIFICADO',
    planHours: horas,
    coveredHours: 0,
    periodStartYmd: '2026-10-01',
    periodEndYmd: '2026-10-31',
  }).billableHours;
}

describe('rotación −F en feriados', () => {
  for (const coverageType of ['custom', '24hs'] as const) {
    it(`${coverageType}: no arma el turno del 12/10/2026 y la prefactura planificada no suma esas 8 h`, () => {
      const menos = applyRotationsForMonth([rotacion()], {}, {}, 2026, 9, [puesto(coverageType, true)]);
      const mas = applyRotationsForMonth([rotacion()], {}, {}, 2026, 9, [puesto(coverageType, false)]);
      assert.equal(menos[`e1_${FERIADO}`], undefined);
      assert.equal(menos[`e1_${LUNES}`]?.code, 'M');
      assert.equal(menos[`e1_${LUNES}`]?.hours, 8);
      assert.equal(mas[`e1_${FERIADO}`]?.code, 'M');
      assert.equal(facturaPlan(horasPlan(mas)) - facturaPlan(horasPlan(menos)), 8);
      const fechas = getAllDatesInMonth(2026, 9);
      const porFecha = buildSlaRotationByDate([rotacion()], fechas, [puesto(coverageType, true)]);
      assert.equal(porFecha?.[FERIADO], undefined);
      assert.equal(porFecha?.[LUNES]?.e1?.shiftCode, 'M');
      const mapa = rotationAdditionsToSlaRotationByDate(menos, fechas);
      assert.equal(mapa?.[FERIADO], undefined);
    });
  }

  it('ciclo de trabajo anclado en el feriado tampoco genera la banda', () => {
    const menos = applyRotationsForMonth(
      [rotacion({ cycleMode: 'cycle_rotation', cycleWorkDays: 6, cycleOffDays: 1 })],
      {},
      {},
      2026,
      9,
      [puesto('custom', true)],
    );
    assert.equal(menos[`e1_${FERIADO}`], undefined);
    assert.equal(menos[`e1_${LUNES}`]?.code, 'M');
  });

  it('+F explícito sigue generando el feriado', () => {
    const pos = { ...puesto('custom', false), trabajaFeriados: true as const };
    const mas = applyRotationsForMonth([rotacion()], {}, {}, 2026, 9, [pos]);
    assert.equal(mas[`e1_${FERIADO}`]?.hours, 8);
  });
});
