import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEarlyStartCandidates, listExtensionCandidates } from './planningRecompositionApply';
import { textoTramoSolo, validarClicElegir } from './menuRapidoCobertura';
import { applyOperationalGapCloseToChanges, segmentosMitadHueco } from './operationalGapCoverage';
import { applyVacancyCoverageToChanges } from './vacancyCoverage';
import { defaultSplitTimesCct } from './vacancySplitBands';
import { evaluateCoverageDayGuards } from './vacancyCoverageWizard';
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

test('borradores: la N del día anterior en borrador puede extender una M (cronograma sin publicar)', () => {
  const sm: Record<string, any> = {
    ['kasi_2026-10-10']: { employeeId: 'kasi', objectiveId: OBJ, code: 'N', positionName: 'Puesto 2', startTime: '23:00', endTime: '07:00', draft: true },
    ['mart_2026-10-11']: { employeeId: 'mart', objectiveId: OBJ, code: 'V', positionName: 'Puesto 2', draft: true },
    ['herr_2026-10-11']: { employeeId: 'herr', objectiveId: OBJ, code: 'T', positionName: 'Puesto 2', startTime: '15:00', endTime: '23:00', draft: true },
  };
  const emps = [{ id: 'kasi', name: 'KASIANCHUK' }, { id: 'mart', name: 'MARTINEZ' }, { id: 'herr', name: 'HERRERA' }];
  const ctx2 = { gapPositionName: 'Puesto 2', gapStart: '07:00', gapEnd: '15:00', preferSamePosition: true };
  assert.deepEqual(listExtensionCandidates('M', '2026-10-11', OBJ, emps, sm, {}, ['mart'], ctx2).map((r) => r.id), ['kasi']);
  assert.deepEqual(listEarlyStartCandidates('M', '2026-10-11', OBJ, emps, sm, {}, ['mart'], ctx2).map((r) => r.id), ['herr']);
});

test('hueco M: la extensión se escribe en la N del día anterior, no en el franco del día del hueco', () => {
  const dia = '2026-10-11';
  const prev = '2026-10-10';
  const puesto = [{ positionName: 'Puesto 2', shifts: [
    { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
    { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
    { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
  ] }];
  const shifts: Record<string, any> = {
    [`bordino_${prev}`]: { employeeId: 'bordino', objectiveId: 'obrador', code: 'N', positionName: 'Puesto 2', startTime: '23:00', endTime: '07:00' },
    [`bordino_${dia}`]: { employeeId: 'bordino', objectiveId: 'obrador', code: 'F', positionName: 'Puesto 2', isFranco: true },
    [`barrios_${dia}`]: { employeeId: 'barrios', objectiveId: 'obrador', code: 'T', positionName: 'Puesto 2', startTime: '15:00', endTime: '23:00' },
    [`mart_${dia}`]: { employeeId: 'mart', objectiveId: 'obrador', code: 'V', positionName: 'Puesto 2', originalCode: 'M' },
  };
  const emps = [{ id: 'bordino', name: 'BORDINO' }, { id: 'barrios', name: 'BARRIOS' }, { id: 'mart', name: 'MARTINEZ' }];
  const ctx = { gapPositionName: 'Puesto 2', gapStart: '07:00', gapEnd: '15:00' };
  const ext = listExtensionCandidates('M', dia, 'obrador', emps, shifts, {}, ['mart'], ctx);
  assert.equal(ext[0]?.id, 'bordino');
  assert.equal(ext[0]?.extensionApplyDate, prev);
  const out = applyVacancyCoverageToChanges({}, {
    vacancyData: { employeeId: 'mart', employeeName: 'MARTINEZ', type: 'Vacaciones', startDate: dia },
    days: [{ dateStr: dia, coverage: { mode: 'split', extEmpId: 'bordino', adelEmpId: 'barrios', gapBand: 'M', gapPosition: 'Puesto 2' } }],
    selectedObjective: 'obrador',
    activePosition: 'Puesto 2',
    shiftsMap: shifts,
    getTypicalShift: () => null,
    employeesById: Object.fromEntries(emps.map((e) => [e.id, e])),
    defaultSplitForBand: () => ({ ext: { from: '07:00', to: '11:00' }, adel: { from: '11:00', to: '15:00' } }),
    positionStructure: puesto,
    fallbackGapBand: 'M',
  });
  const noche = out.changes[`bordino_${prev}`];
  const franco = out.changes[`bordino_${dia}`];
  const tarde = out.changes[`barrios_${dia}`];
  assert.equal(noche?.isExtended, true);
  assert.equal(noche?.coverageSegmentRole, 'EXTENSION');
  assert.equal(noche?.segmentFromTime, '07:00');
  assert.equal(noche?.segmentToTime, '11:00');
  assert.equal(noche?.coversPositionName, 'Puesto 2');
  assert.equal(franco?.isExtended, undefined);
  assert.equal(tarde?.isEarlyStart, true);
  assert.equal(tarde?.adjustedStartTime, '11:00');
  assert.equal(out.changes[`mart_${dia}`]?.coverageStatus, 'COVERED');
});

test('hueco N: adelanta la M del día siguiente y la escribe ahí', () => {
  const dia = '2026-10-12';
  const next = '2026-10-13';
  const emps = [{ id: 'herrera', name: 'HERRERA' }, { id: 'morales', name: 'MORALES' }];
  const shifts: Record<string, any> = {
    [`herrera_${dia}`]: { employeeId: 'herrera', objectiveId: 'obrador', code: 'T', positionName: 'Puesto 2', startTime: '15:00', endTime: '23:00' },
    [`morales_${next}`]: { employeeId: 'morales', objectiveId: 'obrador', code: 'M', positionName: 'Puesto 2', startTime: '07:00', endTime: '15:00' },
  };
  const ctx = { gapPositionName: 'Puesto 2', gapStart: '23:00', gapEnd: '07:00' };
  const ext = listExtensionCandidates('N', dia, 'obrador', emps, shifts, {}, [], ctx);
  const adel = listEarlyStartCandidates('N', dia, 'obrador', emps, shifts, {}, [], ctx);
  assert.deepEqual(ext.map((r) => r.id), ['herrera']);
  assert.equal(ext[0].extensionApplyDate, undefined);
  assert.deepEqual(adel.map((r) => r.id), ['morales']);
  assert.equal(adel[0].earlyStartApplyDate, next);
  const changes = applyOperationalGapCloseToChanges({}, {
    objectiveId: 'obrador',
    dateStr: dia,
    gapPosition: 'Puesto 2',
    gapBand: 'N',
    gapFrom: '23:00',
    gapTo: '07:00',
    extEmpId: 'herrera',
    secondEmpId: 'morales',
  }, { shiftsMap: shifts, employeesById: Object.fromEntries(emps.map((e) => [e.id, e])) });
  assert.equal(changes[`herrera_${dia}`].isExtended, true);
  assert.equal(changes[`herrera_${dia}`].segmentToTime, '03:00');
  assert.equal(changes[`morales_${next}`].isEarlyStart, true);
  assert.equal(changes[`morales_${next}`].coverageSegmentRole, 'EARLY_START');
  assert.equal(changes[`morales_${next}`].adjustedStartTime, '03:00');
  assert.equal(changes[`morales_${dia}`], undefined);
});

test('hueco N parte en 23:00–03:00 y 03:00–07:00', () => {
  const t = defaultSplitTimesCct('N');
  assert.equal(t.ext.from, '23:00');
  assert.equal(t.ext.to, '03:00');
  assert.equal(t.adel.from, '03:00');
  assert.equal(t.adel.to, '07:00');
});

test('adelanto del día siguiente no se mide como un turno nuevo del día del hueco', () => {
  const dia = '2026-10-12';
  const next = '2026-10-13';
  const shifts: Record<string, any> = {
    [`herrante_${dia}`]: { code: 'M', startTime: '07:00', endTime: '15:00' },
    [`herrante_${next}`]: { code: 'M', startTime: '07:00', endTime: '15:00' },
  };
  const shiftOf = (id: string, d: string) => shifts[`${id}_${d}`] || null;
  const mal = evaluateCoverageDayGuards({
    dateStr: dia,
    proposedByEmp: { herrante: { code: 'M', startTime: '23:00', endTime: '07:00', addHours: 4 } },
    shiftOf,
    monthHoursOf: () => 100,
    nameOf: () => 'HERRANTE',
  });
  assert.ok(mal.blocked.some((m) => /descanso/i.test(m)));
  const bien = evaluateCoverageDayGuards({
    dateStr: dia,
    proposedByEmp: { herrante: { code: 'M', startTime: '03:00', endTime: '15:00', addHours: 4, applyDateStr: next } },
    shiftOf,
    monthHoursOf: () => 100,
    nameOf: () => 'HERRANTE',
  });
  assert.deepEqual(bien.blocked, []);
});
