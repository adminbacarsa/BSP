import assert from 'node:assert/strict';
import test from 'node:test';
import { estadoNovedadAusencia, resumenAusenciaDia, TEXTO_LO_CUBRIO_OPERACIONES } from '@/lib/planificacion/coberturaExistente';

const cardo = {
  id: 'shift-cardo',
  employeeId: 'cardo',
  code: 'M2',
  positionName: 'Puesto 2',
  startTime: '2026-10-07T14:45:00.000Z',
  endTime: '2026-10-07T18:30:00.000Z',
  hours: 3.8,
  isAbsent: true,
  status: 'ABSENT',
  operacionallyCovered: true,
  coverageStatus: 'COVERED',
  coverageType: 'REF',
  coveredByEmployeeName: 'KOPP Franco Isaias',
  coveredByEmployeeId: 'kopp',
  resolvedBy: 'OPERACIONES',
  coverageDocId: 'ops_cov_shift-cardo_kopp',
};

const opsKopp = {
  id: 'ops_cov_shift-cardo_kopp',
  employeeId: 'kopp',
  employeeName: 'KOPP Franco Isaias',
  origin: 'OPERATIONS_COVERAGE',
  code: 'M2',
  codigoOriginal: 'REF',
  coverageType: 'REF',
  absenceShiftId: 'shift-cardo',
  positionName: 'Puesto 2',
  startTime: '2026-10-07T14:45:00.000Z',
  endTime: '2026-10-07T18:30:00.000Z',
  checkInAt: '2026-10-07T14:37:00.000Z',
};

const aviso = {
  shiftId: 'shift-cardo',
  type: 'Ausencia con aviso',
  status: 'Avisada',
  revisionEstado: 'POR_REVISAR',
  absenceType: 'AA',
  source: 'EMPLEADO',
};

test('ausencia cubierta por Operaciones con REF: turno real y quién cubre', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'cardo',
    titularName: 'CARDO ANALIA VERONICA',
    date: '2026-10-07',
    titular: cardo,
    turnosDelDia: [cardo, opsKopp],
    ausencia: aviso,
  });
  assert.deepEqual(r.turno, {
    code: 'M2',
    positionName: 'Puesto 2',
    scheduleLabel: '11:45–15:30',
    hours: 3.8,
  });
  assert.equal(r.cubiertoPor, 'KOPP Franco Isaias · REF · desde Operaciones 11:37');
  assert.equal(r.esOperaciones, true);
  assert.equal(r.nota, TEXTO_LO_CUBRIO_OPERACIONES);
  assert.equal(r.tipoNovedad, 'Ausencia con aviso');
  assert.equal(r.estadoNovedad, 'Avisada · Por revisar');
  assert.equal(r.cobertura.origen, 'operaciones');
});

test('el turno se recupera por ausencias.shiftId aunque la celda no traiga el doc', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'cardo',
    date: '2026-10-07',
    titular: null,
    turnosDelDia: [cardo, opsKopp],
    ausencia: aviso,
  });
  assert.equal(r.turno?.code, 'M2');
  assert.equal(r.turno?.scheduleLabel, '11:45–15:30');
  assert.equal(r.cubiertoPor, 'KOPP Franco Isaias · REF · desde Operaciones 11:37');
});

test('titular con doc AA conserva el turno de trabajo', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'cardo',
    date: '2026-10-07',
    titular: {
      id: 'shift-cardo',
      employeeId: 'cardo',
      code: 'AA',
      isAbsent: true,
      originalCode: 'M2',
      originalPositionName: 'Puesto 2',
      startTime: '2026-10-07T14:45:00.000Z',
      endTime: '2026-10-07T18:30:00.000Z',
      hours: 3.8,
    },
    turnosDelDia: [],
    ausencia: aviso,
  });
  assert.equal(r.turno?.code, 'M2');
  assert.equal(r.turno?.positionName, 'Puesto 2');
  assert.equal(r.turno?.scheduleLabel, '11:45–15:30');
  assert.equal(r.cubiertoPor, null);
});

test('si el doc AA perdió el horario, lo toma del ops_cov', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'cardo',
    date: '2026-10-07',
    titular: { id: 'shift-cardo', employeeId: 'cardo', code: 'AA', isAbsent: true, startTime: '00:00', endTime: '00:00' },
    turnosDelDia: [opsKopp],
    ausencia: aviso,
  });
  assert.equal(r.turno?.code, 'M2');
  assert.equal(r.turno?.positionName, 'Puesto 2');
  assert.equal(r.turno?.scheduleLabel, '11:45–15:30');
  assert.match(r.cubiertoPor || '', /KOPP Franco Isaias · REF · desde Operaciones 11:37/);
});

test('cubierta planificada con RET', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'baez',
    titularName: 'BAEZ, Carlos',
    date: '2026-10-07',
    titular: { id: 'shift-baez', employeeId: 'baez', code: 'V', coverageType: 'SUBSTITUTE', coveredByEmployeeId: 'gomez' },
    turnosDelDia: [{ employeeId: 'gomez', employeeName: 'GOMEZ, Ana', code: 'RET', coversEmployeeId: 'baez' }],
  });
  assert.equal(r.cobertura.origen, 'planificada');
  assert.equal(r.cubiertoPor, 'GOMEZ (RET) · planificada');
  assert.equal(r.esOperaciones, false);
  assert.equal(r.nota, '');
});

test('Ext+Adel nombra las dos patas', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'baez',
    titularName: 'BAEZ, Carlos',
    date: '2026-10-07',
    titular: { id: 'shift-baez', employeeId: 'baez', code: 'E', originalCode: 'M', coverageType: 'SPLIT' },
    turnosDelDia: [
      { employeeId: 'galeano', employeeName: 'GALEANO, Pedro', isExtended: true, coversEmployeeId: 'baez', code: 'M' },
      { employeeId: 'barros', employeeName: 'BARROS, Luis', isEarlyStart: true, coversEmployeeId: 'baez', code: 'T' },
    ],
  });
  assert.equal(r.cubiertoPor, 'GALEANO (ext) · BARROS (adel)');
  assert.equal(r.turno?.code, 'M');
});

test('cobertura parcial dice el tramo que falta', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'baez',
    date: '2026-10-07',
    titular: {
      id: 'shift-baez',
      employeeId: 'baez',
      code: 'M',
      coverageStatus: 'PARTIAL',
      coverageType: 'EXTEND',
      coveredByEmployeeName: 'LALLANA Fabian Alberto',
      startTime: '2026-10-07T10:00:00.000Z',
      endTime: '2026-10-07T18:00:00.000Z',
      isAbsent: true,
    },
    turnosDelDia: [{
      id: 'ops_cov_shift-baez_lallana',
      employeeId: 'lallana',
      employeeName: 'LALLANA Fabian Alberto',
      origin: 'OPERATIONS_COVERAGE',
      code: 'M',
      coverageType: 'EXTEND',
      absenceShiftId: 'shift-baez',
    }],
  });
  assert.equal(r.cobertura.origen, 'operaciones');
  assert.match(r.cubiertoPor || '', /^Parcial · LALLANA Fabian Alberto \(EXT\) · falta /);
  assert.equal(r.esOperaciones, false);
});

test('sin cobertura', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'baez',
    date: '2026-10-07',
    titular: { id: 'shift-baez', employeeId: 'baez', code: 'AA', isAbsent: true },
    turnosDelDia: [],
  });
  assert.equal(r.cobertura.origen, 'ninguna');
  assert.equal(r.cubiertoPor, null);
  assert.equal(r.turno, null);
});

test('consulta en curso', () => {
  const r = resumenAusenciaDia({
    titularEmployeeId: 'baez',
    date: '2026-10-07',
    titular: { id: 'shift-baez', employeeId: 'baez', code: 'V' },
    consulta: { status: 'ABIERTA', respuestas: [], venceAtMs: Date.parse('2026-10-07T14:15:00.000Z') },
  });
  assert.equal(r.cobertura.origen, 'consulta');
  assert.equal(r.cubiertoPor, 'Consultando');
});

test('el aviso del portal no se muestra como Autorizada', () => {
  assert.deepEqual(
    estadoNovedadAusencia({ type: 'Ausencia con aviso', status: 'Avisada', revisionEstado: 'POR_REVISAR' }),
    { tipo: 'Ausencia con aviso', estado: 'Avisada · Por revisar' },
  );
  assert.deepEqual(
    estadoNovedadAusencia({ type: 'Enfermedad', status: 'Justificada', revisionEstado: 'JUSTIFICADA', avisoPortal: true }),
    { tipo: 'Enfermedad', estado: 'Justificada' },
  );
  assert.equal(estadoNovedadAusencia({ type: 'Vacaciones', status: 'Autorizada' }).estado, 'Autorizada');
  assert.equal(estadoNovedadAusencia({ type: 'Ausencia con aviso', status: '' }).estado, 'Avisada · Por revisar');
});
