import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectSplitBandCreditsForDay } from './positionCoverageUnits';
import {
  aporteDelTurnoAlDia,
  diaAcreditacionCobertura,
  ubicarTooltipCelda,
} from './coberturaDiaHueco';

const DIA11 = '2026-10-11';
const DIA12 = '2026-10-12';
const DIA10 = '2026-10-10';
const DIA13 = '2026-10-13';

describe('acreditación del día del hueco', () => {
  it('el adelanto de la M del 12 que cubre la N del 11 cierra el 11', () => {
    const adel = {
      code: 'M',
      isEarlyStart: true,
      coverageSegmentRole: 'EARLY_START',
      coversBandCode: 'N',
      segmentFromTime: '03:00',
      segmentToTime: '07:00',
      coverageStatus: 'COVERED',
    };
    assert.equal(diaAcreditacionCobertura(adel, DIA12), DIA11);
    assert.equal(diaAcreditacionCobertura({ ...adel, coversDateStr: DIA11 }, DIA12), DIA11);
  });

  it('la extensión de la N del 10 que cubre la M del 11 cierra el 11', () => {
    const ext = {
      code: 'N',
      startTime: '23:00',
      endTime: '07:00',
      isExtended: true,
      coverageSegmentRole: 'EXTENSION',
      coversBandCode: 'M',
      segmentFromTime: '07:00',
      segmentToTime: '11:00',
      coverageStatus: 'COVERED',
    };
    assert.equal(diaAcreditacionCobertura(ext, DIA10), DIA11);
    assert.equal(aporteDelTurnoAlDia(ext, DIA10, DIA10), 'solo-base');
    assert.equal(aporteDelTurnoAlDia(ext, DIA10, DIA11), 'solo-tramo');
  });

  it('datos viejos: la N del 11 no se acredita en el 12 ni la M en el 10', () => {
    const emps = [{ id: 'herrera' }, { id: 'herrante' }, { id: 'kasian' }];
    const turnos: Record<string, any> = {
      [`herrera_${DIA11}`]: {
        code: 'T',
        positionName: 'Puesto 2',
        objectiveId: 'obj',
        isExtended: true,
        coverageSegmentRole: 'EXTENSION',
        coveragePackageId: 'pkg-11',
        coverageStatus: 'COVERED',
        coversBandCode: 'N',
        coversPositionName: 'Puesto 2',
        coversEmployeeId: 'martinez',
        segmentFromTime: '23:00',
        segmentToTime: '03:00',
      },
      [`herrante_${DIA12}`]: {
        code: 'M',
        positionName: 'Puesto 2',
        objectiveId: 'obj',
        isEarlyStart: true,
        coverageSegmentRole: 'EARLY_START',
        coveragePackageId: 'pkg-11',
        coverageStatus: 'COVERED',
        coversBandCode: 'N',
        coversPositionName: 'Puesto 2',
        coversEmployeeId: 'martinez',
        segmentFromTime: '03:00',
        segmentToTime: '07:00',
      },
      [`kasian_${DIA10}`]: {
        code: 'N',
        startTime: '23:00',
        endTime: '07:00',
        positionName: 'Puesto 2',
        objectiveId: 'obj',
        isExtended: true,
        coverageSegmentRole: 'EXTENSION',
        coveragePackageId: 'pkg-m',
        coverageStatus: 'COVERED',
        coversBandCode: 'M',
        coversPositionName: 'Puesto 2',
        segmentFromTime: '07:00',
        segmentToTime: '11:00',
      },
    };
    const leer = (empId: string, ds: string) => turnos[`${empId}_${ds}`] || null;
    const opts = { selectedObjective: 'obj' };
    const n11 = collectSplitBandCreditsForDay(emps, DIA11, leer, opts);
    const n12 = collectSplitBandCreditsForDay(emps, DIA12, leer, opts);
    const m10 = collectSplitBandCreditsForDay(emps, DIA10, leer, opts);
    assert.equal(n11['Puesto 2']?.N, 1);
    assert.equal(n12['Puesto 2']?.N, undefined);
    assert.equal(m10['Puesto 2']?.M, undefined);
    const m11 = collectSplitBandCreditsForDay(emps, DIA11, leer, opts);
    assert.equal(m11['Puesto 2']?.M, 1);
  });

  it('con coversDateStr el 13 no hereda el adelanto que cubre el 12', () => {
    const emps = [{ id: 'herrera' }, { id: 'herrante' }];
    const turnos: Record<string, any> = {
      [`herrera_${DIA12}`]: {
        code: 'T',
        positionName: 'Puesto 2',
        objectiveId: 'obj',
        isExtended: true,
        coveragePackageId: 'pkg-12',
        coverageStatus: 'COVERED',
        coversBandCode: 'N',
        coversPositionName: 'Puesto 2',
        coversDateStr: DIA12,
        segmentFromTime: '23:00',
        segmentToTime: '03:00',
      },
      [`herrante_${DIA13}`]: {
        code: 'M',
        positionName: 'Puesto 2',
        objectiveId: 'obj',
        isEarlyStart: true,
        coveragePackageId: 'pkg-12',
        coverageStatus: 'COVERED',
        coversBandCode: 'N',
        coversPositionName: 'Puesto 2',
        coversDateStr: DIA12,
        segmentFromTime: '03:00',
        segmentToTime: '07:00',
      },
    };
    const leer = (empId: string, ds: string) => turnos[`${empId}_${ds}`] || null;
    const opts = { selectedObjective: 'obj' };
    assert.equal(collectSplitBandCreditsForDay(emps, DIA12, leer, opts)['Puesto 2']?.N, 1);
    assert.equal(collectSplitBandCreditsForDay(emps, DIA13, leer, opts)['Puesto 2']?.N, undefined);
  });

  it('el tooltip del día 31 y de la última fila queda dentro de la pantalla', () => {
    const derecha = ubicarTooltipCelda(1400, 200, 280, 120, 1440, 900);
    assert.ok(derecha.left + 280 <= 1440);
    assert.ok(derecha.left < 1400);
    const abajo = ubicarTooltipCelda(400, 860, 280, 120, 1440, 900);
    assert.ok(abajo.top + 120 <= 900);
    assert.ok(abajo.top < 860);
  });
});
