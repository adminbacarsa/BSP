/**
 * Una cobertura REF/ESC/RET es un solo turno (el del titular).
 * La prefactura cobra esa franja si el que cubre está presente en el ops_cov.
 * La liquidación no suma además el REF fuente.
 *
 * npx tsx --test src/lib/crm/coberturaUnTurno.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executedBillableHoursByFranja } from './executedBillableHoursByFranja.ts';
import { calculateLiquidationHoursStats } from '../../../../../packages/hours-core/src/motors/liquidation/reportesLiquidation.ts';

function ts(iso: string) {
  const d = new Date(iso);
  return { seconds: Math.floor(d.getTime() / 1000), toDate: () => d };
}

const inicio = '2026-10-06T07:00:00-03:00';
const fin = '2026-10-06T15:00:00-03:00';

function titular() {
  return {
    id: 'titular',
    objectiveId: 'peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 2',
    employeeId: 'titular-emp',
    employeeName: 'TITULAR',
    code: 'M',
    startTime: ts(inicio),
    endTime: ts(fin),
    isAbsent: true,
    status: 'ABSENT',
  };
}

function cobertura(presente: boolean) {
  return {
    id: 'ops_cov_titular_kopp',
    objectiveId: 'peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 2',
    employeeId: 'kopp',
    employeeName: 'KOPP',
    code: 'M',
    origin: 'OPERATIONS_COVERAGE',
    coverageType: 'REF',
    codigoOriginal: 'REF',
    coverageForShiftId: 'titular',
    absenceShiftId: 'titular',
    sourceShiftId: 'ref',
    startTime: ts(inicio),
    endTime: ts(fin),
    isPresent: presente,
    status: presente ? 'PRESENT' : 'PENDING',
    ...(presente ? { realStartTime: ts(inicio), realEndTime: ts(fin), checkInAt: ts('2026-10-06T06:52:00-03:00') } : {}),
  };
}

function fuente(anulada: boolean) {
  return {
    id: 'ref',
    objectiveId: 'peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 2',
    employeeId: 'kopp',
    employeeName: 'KOPP',
    code: 'REF',
    startTime: ts(inicio),
    endTime: ts(fin),
    isPresent: true,
    status: anulada ? 'CANCELLED' : 'PRESENT',
    isDeleted: anulada,
    coverageUsed: anulada,
    realStartTime: ts(inicio),
    realEndTime: ts(fin),
  };
}

describe('un turno: prefactura y liquidación', () => {
  it('la franja cubierta factura 8 h y el REF anulado no suma otra', () => {
    const bien = executedBillableHoursByFranja([titular(), cobertura(true), fuente(true)]);
    assert.equal(bien.totalBillable, 8);
    assert.equal(bien.totalRequested, 8);
    assert.equal(bien.byObjectiveId.peaje, 8);
    assert.equal(bien.buckets[0]?.titulares[0]?.fromCoverage, 8);
    assert.equal(bien.buckets[0]?.titulares[0]?.contributions.length, 1);

    const sinPresencia = executedBillableHoursByFranja([titular(), cobertura(false), fuente(false)]);
    assert.equal(sinPresencia.totalBillable, 0);
  });

  it('la liquidación del que cubre cuenta una sola jornada', () => {
    const solo = calculateLiquidationHoursStats([cobertura(true)]);
    const par = calculateLiquidationHoursStats([cobertura(true), fuente(true)]);
    const duplicado = calculateLiquidationHoursStats([cobertura(true), fuente(false)]);
    assert.equal(par.horasReales, solo.horasReales);
    assert.ok(par.horasReales > 7 && par.horasReales < 9);
    assert.ok(duplicado.horasReales < par.horasReales + 1);
    assert.ok(par.desglose.cobertura > 7);
  });
});
