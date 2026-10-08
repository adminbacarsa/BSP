import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEarlyStartCandidates, listExtensionCandidates } from './planningRecompositionApply';
import { textoTramoSolo, validarClicElegir } from './menuRapidoCobertura';
import { applyOperationalGapCloseToChanges, segmentosMitadHueco } from './operationalGapCoverage';
import { calcPlanningBillableHoursAttributedToPosition } from './planningScheduledHours';

const OBJ = 'obj1';
const DIA = '2026-10-01';
const turnos: Array<[string, string, string]> = [
  ['galeano', 'M', 'Guardia'],
  ['perez', 'M', 'Playa'],
  ['sosa', 'M', 'Proveedores'],
  ['ross', 'T', 'Guardia'],
  ['barros', 'N', 'Playa'],
  ['gomez', 'N', 'Guardia'],
];
const employees = turnos.map(([id]) => ({ id, name: id.toUpperCase() }));
const shiftsMap: Record<string, any> = {};
for (const [id, code, positionName] of turnos) {
  shiftsMap[`${id}_${DIA}`] = { employeeId: id, objectiveId: OBJ, code, positionName };
}
const ctx = { gapPositionName: 'Guardia', preferSamePosition: true };

test('extensión ofrece todos los M del objetivo, el del mismo puesto primero', () => {
  const rows = listExtensionCandidates('T', DIA, OBJ, employees, shiftsMap, {}, ['ross'], ctx);
  assert.deepEqual(rows.map((r) => r.id), ['galeano', 'perez', 'sosa']);
});

test('adelanto ofrece todos los N del objetivo, el del mismo puesto primero', () => {
  const rows = listEarlyStartCandidates('T', DIA, OBJ, employees, shiftsMap, {}, ['ross'], ctx);
  assert.deepEqual(rows.map((r) => r.id), ['gomez', 'barros']);
});

function armar(filas: Array<[string, string, string, string, string, Record<string, unknown>?]>, dia: string) {
  const employees = filas.map(([id, , , , , extra]) => ({ id, name: String(extra?.name || id.toUpperCase()) }));
  const shiftsMap: Record<string, any> = {};
  for (const [id, code, positionName, startTime, endTime, extra] of filas) {
    const { name: _n, ...rest } = extra || {};
    shiftsMap[`${id}_${dia}`] = { employeeId: id, objectiveId: 'peaje', code, positionName, startTime, endTime, ...rest };
  }
  return { employees, shiftsMap };
}

test('Peaje 09/10: extender T2 15:30 es por horario, no por la sigla M2', () => {
  const dia = '2026-10-09';
  const filas: Array<[string, string, string, string, string, Record<string, unknown>?]> = [
    ['ferrero', 'M', 'Puesto 2', '11:30', '15:15'],
    ['bosio', 'M', 'Puesto 2', '11:30', '15:15'],
    ['cardo', 'M2', 'Puesto 2', '11:45', '15:30', { isAbsent: true }],
    ['kopp', 'M2', 'Puesto 2', '11:45', '15:30', { origin: 'OPERATIONS_COVERAGE', codigoOriginal: 'REF' }],
    ['garcia', 'M2', 'Puesto 2', '11:45', '15:30'],
    ['lopez', 'T', 'Puesto 2', '15:15', '16:15'],
    ['brizuela', 'T', 'Puesto 2', '15:15', '16:15'],
    ['lozano', 'REF', 'Puesto 2', '15:15', '16:15'],
    ['campos', 'REF', 'Puesto 2', '15:30', '16:30'],
    ['bazan', 'T2', 'Puesto 2', '15:30', '16:30'],
    ['gonzalez', 'V', 'Puesto 2', '15:30', '16:30'],
    ['baez', 'M', 'Puesto 1', '10:45', '12:00'],
    ['fantini', 'M2', 'Puesto 1', '11:00', '15:00'],
    ['guerrero', 'T', 'Puesto 1', '12:00', '14:30'],
    ['farias', 'M3', 'Puesto 1', '12:30', '16:00'],
    ['fontana', 'T2', 'Puesto 1', '15:00', '17:00'],
    ['venencia', 'T3', 'Puesto 1', '16:00', '17:00'],
    ['lejos', 'M', 'Puesto 2', '11:30', '13:30'],
  ];
  const { employees, shiftsMap } = armar(filas, dia);
  const ctx = { gapPositionName: 'Puesto 2', gapStart: '15:30', gapEnd: '16:30' };
  const ext = listExtensionCandidates('T2', dia, 'peaje', employees, shiftsMap, {}, ['gonzalez'], ctx);
  assert.deepEqual(ext.map((r) => r.id), ['garcia', 'bosio', 'ferrero', 'fantini']);
  assert.equal(ext.find((r) => r.id === 'ferrero')?.textoFila, 'FERRERO · M 11:30–15:15 · termina 15 min antes');
  assert.equal(ext.find((r) => r.id === 'garcia')?.textoFila, 'GARCIA · M2 11:45–15:30 · termina a la hora');
  assert.equal(ext.find((r) => r.id === 'fantini')?.textoFila, 'FANTINI · M2 11:00–15:00 · termina 30 min antes');
  const ids = ext.map((r) => r.id);
  assert.equal(validarClicElegir({
    puedeEditar: true, paso: 'ext', candidatoId: 'ferrero', rol: 'WORKING', candidatosBanda: ids,
    inicioHueco: '15:30', finTurno: '15:15', nombreCandidato: 'FERRERO',
  }).ok, true);
  const lejos = validarClicElegir({
    puedeEditar: true, paso: 'ext', candidatoId: 'lejos', rol: 'WORKING', candidatosBanda: ids,
    inicioHueco: '15:30', finTurno: '13:30', nombreCandidato: 'LEJOS',
  });
  assert.equal(lejos.ok, false);
  assert.match(lejos.motivo || '', /entre las 15:00 y las 15:30/);
  assert.match(lejos.motivo || '', /LEJOS termina 13:30/);
  const farias = validarClicElegir({
    puedeEditar: true, paso: 'ext', candidatoId: 'farias', rol: 'WORKING', candidatosBanda: ids,
    inicioHueco: '15:30', finTurno: '16:00', nombreCandidato: 'FARIAS',
  });
  assert.equal(farias.ok, false);
  assert.match(farias.motivo || '', /FARIAS termina 16:00/);
  const adel = listEarlyStartCandidates('T2', dia, 'peaje', employees, shiftsMap, {}, ['gonzalez'], ctx);
  assert.deepEqual(adel.map((r) => r.id), []);
  assert.equal(textoTramoSolo('ext', '16:30'), 'Nadie arranca a las 16:30 · Aplicar solo la extensión hasta 16:30');
});

test('H. de Niños: M que terminan 15:00 extienden el T, N que arrancan 23:00 lo adelantan', () => {
  const dia = '2026-10-09';
  const filas: Array<[string, string, string, string, string]> = [
    ['m1', 'M', 'Guardia', '07:00', '15:00'],
    ['m2', 'M', 'Playa', '07:00', '15:00'],
    ['t1', 'T', 'Guardia', '15:00', '23:00'],
    ['n1', 'N', 'Guardia', '23:00', '07:00'],
    ['n2', 'N', 'Playa', '23:00', '07:00'],
    ['temprano', 'M', 'Guardia', '07:00', '13:00'],
  ];
  const { employees, shiftsMap } = armar(filas.map((f) => [f[0], f[1], f[2], f[3], f[4]]), dia);
  const ctx = { gapPositionName: 'Guardia', gapStart: '15:00', gapEnd: '23:00' };
  const ext = listExtensionCandidates('T', dia, 'peaje', employees, shiftsMap, {}, ['t1'], ctx);
  assert.deepEqual(ext.map((r) => r.id), ['m1', 'm2']);
  const adel = listEarlyStartCandidates('T', dia, 'peaje', employees, shiftsMap, {}, ['t1'], ctx);
  assert.deepEqual(adel.map((r) => r.id), ['n1', 'n2']);
});

test('la N del día anterior que termina a las 07:00 puede extender la M', () => {
  const dia = '2026-10-09';
  const prev = '2026-10-08';
  const employees = [{ id: 'noche', name: 'NOCHE' }, { id: 'maniana', name: 'MANIANA' }];
  const shiftsMap: Record<string, any> = {
    [`noche_${prev}`]: { employeeId: 'noche', objectiveId: 'peaje', code: 'N', positionName: 'Puesto 1', startTime: '23:00', endTime: '07:00' },
    [`maniana_${dia}`]: { employeeId: 'maniana', objectiveId: 'peaje', code: 'M', positionName: 'Puesto 1', startTime: '07:00', endTime: '15:00' },
  };
  const rows = listExtensionCandidates('M', dia, 'peaje', employees, shiftsMap, {}, ['maniana'], {
    gapPositionName: 'Puesto 1', gapStart: '07:00', gapEnd: '15:00',
  });
  assert.deepEqual(rows.map((r) => r.id), ['noche']);
  assert.equal(rows[0].extensionApplyDate, prev);
});

test('H. de Niños 09/10: el hueco Rondin M lo extiende la N del 08 y lo adelanta el T de las 15:00', () => {
  const dia = '2026-10-09';
  const prev = '2026-10-08';
  const employees = [
    { id: 'gaitan', name: 'GAITAN' },
    { id: 'canet', name: 'CANET ENRIQUE' },
    { id: 'obregon', name: 'OBREGON LORENA' },
  ];
  const shiftsMap: Record<string, any> = {
    [`gaitan_${prev}`]: { employeeId: 'gaitan', objectiveId: 'ninos', code: 'N', positionName: 'Rondin', startTime: '23:00', endTime: '07:00', hours: 8 },
    [`canet_${dia}`]: { employeeId: 'canet', objectiveId: 'ninos', code: 'T', positionName: 'Playa', startTime: '15:00', endTime: '23:00', hours: 8 },
    [`obregon_${dia}`]: { employeeId: 'obregon', objectiveId: 'ninos', code: 'N', positionName: 'Rondin', startTime: '23:00', endTime: '07:00', hours: 8 },
  };
  const ctx = { gapPositionName: 'Rondin', gapStart: '07:00', gapEnd: '15:00' };
  const ext = listExtensionCandidates('M', dia, 'ninos', employees, shiftsMap, {}, [], ctx);
  const adel = listEarlyStartCandidates('M', dia, 'ninos', employees, shiftsMap, {}, [], ctx);
  assert.deepEqual(ext.map((r) => r.id), ['gaitan']);
  assert.equal(ext[0].extensionApplyDate, prev);
  assert.deepEqual(adel.map((r) => r.id), ['canet']);
  assert.equal(adel.some((r) => r.id === 'obregon'), false);
  assert.equal(ext.some((r) => r.id === 'obregon'), false);

  const changes = applyOperationalGapCloseToChanges({}, {
    objectiveId: 'ninos',
    dateStr: dia,
    gapPosition: 'Rondin',
    gapBand: 'M',
    gapFrom: '07:00',
    gapTo: '15:00',
    extEmpId: 'canet',
    secondEmpId: 'gaitan',
  }, { shiftsMap, employeesById: Object.fromEntries(employees.map((e) => [e.id, e])) });

  const noche = changes[`gaitan_${prev}`];
  const tarde = changes[`canet_${dia}`];
  assert.equal(noche.coverageSegmentRole, 'EXTENSION');
  assert.equal(noche.isExtended, true);
  assert.equal(noche.segmentFromTime, '07:00');
  assert.equal(noche.segmentToTime, '11:00');
  assert.notEqual(noche.segmentFromTime, noche.segmentToTime);
  assert.equal(noche.extExtraHours, 4);
  assert.equal(tarde.coverageSegmentRole, 'EARLY_START');
  assert.equal(tarde.isEarlyStart, true);
  assert.equal(tarde.isExtended, false);
  assert.equal(tarde.segmentFromTime, '11:00');
  assert.equal(tarde.segmentToTime, '15:00');
  assert.notEqual(tarde.segmentFromTime, tarde.segmentToTime);
  assert.equal(tarde.coversPositionName, 'Rondin');
  assert.equal(calcPlanningBillableHoursAttributedToPosition(tarde, 'Playa'), 8);
  assert.equal(calcPlanningBillableHoursAttributedToPosition(tarde, 'Rondin'), 4);

  assert.throws(
    () => applyOperationalGapCloseToChanges({}, {
      objectiveId: 'ninos',
      dateStr: dia,
      gapPosition: 'Rondin',
      gapBand: 'M',
      gapFrom: '07:00',
      gapTo: '15:00',
      extEmpId: 'canet',
      secondEmpId: 'obregon',
    }, { shiftsMap, employeesById: Object.fromEntries(employees.map((e) => [e.id, e])) }),
    /adelanto|23:00/,
  );
  assert.throws(() => segmentosMitadHueco(dia, '15:00', '15:00'), /0 h/);
});
