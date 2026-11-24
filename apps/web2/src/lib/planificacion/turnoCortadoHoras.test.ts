/**
 * Turno cortado: la jornada es la suma de los tramos (10–13 + 14–17 = 6 h), no el span 10–17.
 * Operaciones corre `endTime` al fin del último tramo, así que fin − inicio incluye el hueco.
 *
 * npx tsx --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/planificacion/turnoCortadoHoras.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { huecosPlanificadosCortado, huecosRealesCortado } from '../../../../../packages/hours-core/src/motors/planning/turnoCortadoHoras.ts';
import { accumulatePayrollTurnoContribution } from '../../../../../packages/hours-core/src/motors/server/payrollTurnoAccumulator.ts';
import { calculateLiquidationHoursStats } from '../../../../../packages/hours-core/src/motors/liquidation/reportesLiquidation.ts';
import { executedBillableHoursByFranja } from '../crm/executedBillableHoursByFranja.ts';

function ts(iso: string) {
  const d = new Date(iso);
  return { seconds: Math.floor(d.getTime() / 1000), toDate: () => d, toMillis: () => d.getTime() };
}

const BLOQUES = [{ startTime: '10:00', endTime: '13:00' }, { startTime: '14:00', endTime: '17:00' }];

function cortado(extra: Record<string, unknown> = {}) {
  return {
    id: 'co1',
    employeeId: 'emp1',
    employeeName: 'ACOSTA',
    objectiveId: 'banco',
    objectiveName: 'Banco',
    positionName: 'Casa Matriz',
    code: 'CO',
    hours: 6,
    blocks: BLOQUES,
    startTime: ts('2026-11-18T10:00:00-03:00'),
    // Operaciones corrió el fin al del tramo 2.
    endTime: ts('2026-11-18T17:00:00-03:00'),
    isPresent: false,
    isCompleted: true,
    status: 'COMPLETED',
    realStartTime: ts('2026-11-18T10:00:00-03:00'),
    realEndTime: ts('2026-11-18T17:00:00-03:00'),
    presenciaBloques: {
      b1: { realStartTime: ts('2026-11-18T10:00:00-03:00'), realEndTime: ts('2026-11-18T13:00:00-03:00'), cerrado: true },
      b2: { realStartTime: ts('2026-11-18T14:00:00-03:00') },
    },
    ...extra,
  };
}

function comun() {
  return {
    id: 'm1',
    employeeId: 'emp2',
    employeeName: 'PEREZ',
    objectiveId: 'banco',
    objectiveName: 'Banco',
    positionName: 'Casa Matriz',
    code: 'M',
    hours: 8,
    startTime: ts('2026-11-18T07:00:00-03:00'),
    endTime: ts('2026-11-18T15:00:00-03:00'),
    isCompleted: true,
    status: 'COMPLETED',
    realStartTime: ts('2026-11-18T07:00:00-03:00'),
    realEndTime: ts('2026-11-18T15:00:00-03:00'),
  };
}

describe('turno cortado: hueco entre tramos', () => {
  it('el hueco es de 13 a 14 y un turno común no tiene', () => {
    const h = huecosPlanificadosCortado(cortado());
    assert.equal(h.length, 1);
    assert.equal(h[0].startMs, new Date('2026-11-18T13:00:00-03:00').getTime());
    assert.equal(h[0].endMs, new Date('2026-11-18T14:00:00-03:00').getTime());
    assert.deepEqual(huecosPlanificadosCortado(comun()), []);
  });

  it('con presencia real el hueco va del egreso del tramo 1 al ingreso del tramo 2', () => {
    const d = cortado({
      presenciaBloques: {
        b1: { realEndTime: ts('2026-11-18T13:10:00-03:00') },
        b2: { realStartTime: ts('2026-11-18T14:05:00-03:00') },
      },
    });
    const h = huecosRealesCortado(d);
    assert.equal(h[0].startMs, new Date('2026-11-18T13:10:00-03:00').getTime());
    assert.equal(h[0].endMs, new Date('2026-11-18T14:05:00-03:00').getTime());
  });

  it('libro de horas: 6 h reales, no 7', () => {
    const real = accumulatePayrollTurnoContribution(cortado(), { hoursMode: 'real', holidays: new Set() });
    assert.equal(real.hsReales, 6);
    assert.equal(real.hsTeoricas, 6);
    const plan = accumulatePayrollTurnoContribution(cortado(), { hoursMode: 'planned', holidays: new Set() });
    assert.equal(plan.hsReales, 6);
    const m = accumulatePayrollTurnoContribution(comun(), { hoursMode: 'real', holidays: new Set() });
    assert.equal(m.hsReales, 8);
  });

  it('Liquidación: 6 h reales y un turno común no cambia', () => {
    const solo = calculateLiquidationHoursStats([cortado()]);
    assert.equal(Math.round(solo.horasReales * 100) / 100, 6);
    const m = calculateLiquidationHoursStats([comun()]);
    assert.equal(Math.round(m.horasReales * 100) / 100, 8);
  });

  it('nocturnas: el hueco de un turno cortado nocturno no cuenta como noche', () => {
    // 19–22 + 23–02: banda 19:00–02:00 (7 h), hueco 22–23 (nocturno), trabajado 6 h.
    const noche = cortado({
      blocks: [{ startTime: '19:00', endTime: '22:00' }, { startTime: '23:00', endTime: '02:00' }],
      startTime: ts('2026-11-18T19:00:00-03:00'),
      endTime: ts('2026-11-19T02:00:00-03:00'),
      realStartTime: ts('2026-11-18T19:00:00-03:00'),
      realEndTime: ts('2026-11-19T02:00:00-03:00'),
      presenciaBloques: {
        b1: { realStartTime: ts('2026-11-18T19:00:00-03:00'), realEndTime: ts('2026-11-18T22:00:00-03:00'), cerrado: true },
        b2: { realStartTime: ts('2026-11-18T23:00:00-03:00') },
      },
    });
    const liq = calculateLiquidationHoursStats([noche]);
    assert.equal(Math.round(liq.horasReales * 100) / 100, 6);
    // Noche (21–06): 21–22 del tramo 1 + 23–02 del tramo 2 = 4 h. Sin descontar el hueco serían 5.
    assert.equal(Math.round(liq.totalNocturnas * 100) / 100, 4);
    assert.equal(Math.round(liq.totalDiurnas * 100) / 100, 2);
    const libro = accumulatePayrollTurnoContribution(noche, { hoursMode: 'real', holidays: new Set() });
    assert.equal(Math.round(libro.nocturnas * 100) / 100, 4);
  });

  it('tramo 2 sin ingreso marcado: se liquida lo fichado y queda a revisar', () => {
    const sinTramo2 = cortado({
      presenciaBloques: {
        b1: { realStartTime: ts('2026-11-18T10:00:00-03:00'), realEndTime: ts('2026-11-18T13:00:00-03:00'), cerrado: true },
      },
    });
    const liq = calculateLiquidationHoursStats([sinTramo2]);
    assert.equal(liq.requiresReview, true);
    assert.ok(liq.warnings.some((w: string) => w.includes('tramo 2')));
    const libro = accumulatePayrollTurnoContribution(sinTramo2, { hoursMode: 'real', holidays: new Set() });
    assert.ok(libro.warnings.some((w) => w.includes('tramo 2')));
    // Con el ingreso del tramo 2 no hay aviso.
    assert.equal(calculateLiquidationHoursStats([cortado()]).requiresReview, false);
    assert.equal(accumulatePayrollTurnoContribution(cortado(), { hoursMode: 'real', holidays: new Set() }).warnings.length, 0);
  });

  it('prefactura: se piden y se facturan 6 h, no 7', () => {
    const r = executedBillableHoursByFranja([cortado()]);
    assert.equal(r.totalRequested, 6);
    assert.equal(r.totalBillable, 6);
    const m = executedBillableHoursByFranja([comun()]);
    assert.equal(m.totalBillable, 8);
  });
});
