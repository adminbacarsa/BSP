import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acreditacionCierreElegido,
  acreditaCoberturaAlObjetivo,
  bandasAbiertasDelGrupo,
  objetivoPermitidoParaExtender,
} from './grupoCerrarBanda';
import { countPositionClosedUnitsFromShifts } from './positionCoverageUnits';
import { collectSplitBandCreditsForDay } from './positionCoverageUnits';
import { listEarlyStartCandidates, listExtensionCandidates } from './planningRecompositionApply';
import { applySingleShiftExtension } from './shiftExtensionApply';

const DIA = '2026-10-09';
const LETRA = 'V';

const playa = {
  positionName: 'Playa',
  qty: 1,
  coverageType: '24hs',
  shifts: [
    { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00', quantity: 1 },
    { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00', quantity: 1 },
    { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00', quantity: 1 },
  ],
};
const guardia = {
  positionName: 'Guardia',
  qty: 1,
  coverageType: '24hs',
  shifts: [
    { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00', quantity: 1 },
    { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00', quantity: 1 },
    { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00', quantity: 1 },
  ],
};

test('lista las bandas sin cerrar de cada objetivo del grupo', () => {
  const bandas = bandasAbiertasDelGrupo({
    dateStr: DIA,
    dayLetter: LETRA,
    objetivos: [
      {
        id: 'ninos',
        name: 'H. de Niños',
        positions: [playa],
        codeCountsByPosition: { Playa: { M: 1, N: 1 } },
      },
      {
        id: 'casa',
        name: 'Casa Mc Donalds',
        positions: [guardia],
        codeCountsByPosition: { Guardia: { M: 1, T: 1 } },
      },
    ],
  });
  assert.deepEqual(bandas.map((b) => b.etiqueta), [
    'H. de Niños · Playa · T 15:00–23:00 · falta 1',
    'Casa Mc Donalds · Guardia · N 23:00–07:00 · falta 1',
  ]);
});

test('el cierre se acredita al objetivo elegido y cierra su contador', () => {
  const bandas = bandasAbiertasDelGrupo({
    dateStr: DIA,
    dayLetter: LETRA,
    objetivos: [
      {
        id: 'ninos',
        name: 'H. de Niños',
        positions: [playa],
        codeCountsByPosition: { Playa: { M: 1, N: 1 } },
      },
      {
        id: 'casa',
        name: 'Casa Mc Donalds',
        positions: [guardia],
        codeCountsByPosition: { Guardia: { M: 1, T: 1 } },
      },
    ],
  });
  const elegida = bandas.find((b) => b.objectiveId === 'ninos' && b.band === 'T');
  assert.ok(elegida);
  assert.deepEqual(acreditacionCierreElegido(elegida, DIA), {
    objectiveId: 'ninos',
    coversObjectiveId: 'ninos',
    coversPositionName: 'Playa',
    coversBandCode: 'T',
    coversDateStr: DIA,
  });

  const antes = countPositionClosedUnitsFromShifts(playa, LETRA, { M: 1, N: 1 }, undefined, true, DIA);
  assert.equal(antes.closed, 0);
  const turnoCasa = {
    objectiveId: 'casa',
    code: 'M',
    positionName: 'Guardia',
    isExtended: true,
    coveragePackageId: 'pkg-t',
    coverageSegmentRole: 'EXTENSION',
    coverageMode: 'FULL_BAND',
    coverageStatus: 'COVERED',
    coversBandCode: 'T',
    coversPositionName: 'Playa',
    coversDateStr: DIA,
    coversObjectiveId: 'ninos',
    startTime: '07:00',
    endTime: '15:00',
  };
  assert.equal(acreditaCoberturaAlObjetivo(turnoCasa, 'ninos'), true);
  assert.equal(acreditaCoberturaAlObjetivo(turnoCasa, 'casa'), false);
  assert.equal(objetivoPermitidoParaExtender('casa', 'ninos', ['ninos', 'casa']), true);
  assert.equal(objetivoPermitidoParaExtender('afuera', 'ninos', ['ninos', 'casa']), false);

  const employees = [{ id: 'escobar' }];
  const shifts: Record<string, any> = { [`escobar_${DIA}`]: turnoCasa };
  const leer = (objId: string) => (empId: string, ds: string) => {
    const raw = shifts[`${empId}_${ds}`];
    if (!raw || !acreditaCoberturaAlObjetivo(raw, objId)) return null;
    return { ...raw, objectiveId: objId };
  };
  const creditosNinos = collectSplitBandCreditsForDay(employees, DIA, leer('ninos'), { selectedObjective: 'ninos' });
  const creditosCasa = collectSplitBandCreditsForDay(employees, DIA, leer('casa'), { selectedObjective: 'casa' });
  assert.equal(creditosNinos.Playa?.T, 1);
  assert.equal(creditosCasa.Playa?.T, undefined);

  const despues = countPositionClosedUnitsFromShifts(
    playa,
    LETRA,
    { M: 1, N: 1, T: creditosNinos.Playa.T },
    undefined,
    true,
    DIA,
  );
  assert.equal(despues.closed, 1);
  assert.equal(despues.required, 1);

  const escrito = applySingleShiftExtension({}, {
    shiftsMap: { [`escobar_${DIA}`]: { objectiveId: 'casa', code: 'M', positionName: 'Guardia', startTime: '07:00', endTime: '15:00' } },
    positionStructure: [playa],
  }, {
    objectiveId: 'ninos',
    empId: 'escobar',
    dateStr: DIA,
    extraHours: 8,
    coversBandCode: 'T',
    coversPositionName: 'Playa',
    gapBandHours: 8,
  });
  const doc = escrito[`escobar_${DIA}`];
  assert.equal(doc.objectiveId, 'casa');
  assert.equal(doc.coversObjectiveId, 'ninos');
  assert.equal(doc.coversPositionName, 'Playa');
  assert.equal(doc.coversBandCode, 'T');
  assert.equal(doc.coversDateStr, DIA);
});

test('la extensión del grupo toma al guardia del otro objetivo y deja afuera al de afuera', () => {
  const dia = DIA;
  const employees = [
    { id: 'escobar', name: 'ESCOBAR' },
    { id: 'ajeno', name: 'AJENO' },
  ];
  const shiftsMap: Record<string, any> = {
    [`escobar_${dia}`]: { employeeId: 'escobar', objectiveId: 'casa', code: 'M', positionName: 'Guardia', startTime: '07:00', endTime: '15:00' },
    [`ajeno_${dia}`]: { employeeId: 'ajeno', objectiveId: 'afuera', code: 'M', positionName: 'Otro', startTime: '07:00', endTime: '15:00' },
  };
  const ctx = {
    gapPositionName: 'Playa',
    gapStart: '15:00',
    gapEnd: '23:00',
    positionStructure: [playa],
    objectiveIdsPermitidos: ['ninos', 'casa'],
  };
  const rows = listExtensionCandidates('T', dia, 'ninos', employees, shiftsMap, {}, [], ctx);
  assert.deepEqual(rows.map((r) => r.id), ['escobar']);
});

test('el adelanto de la N lista el grupo entero, mismo puesto primero, y deja afuera al de afuera', () => {
  const dia = DIA;
  const manana = '2026-10-10';
  const employees = [
    { id: 'navarro', name: 'NAVARRO ASTRADA, ROXANA' },
    { id: 'galeano', name: 'GALEANO, MARCOS' },
    { id: 'alaniz', name: 'ALANIZ, PEDRO' },
    { id: 'escobar', name: 'ESCOBAR, JUANA' },
    { id: 'dominguez', name: 'DOMINGUEZ, CARLOS' },
    { id: 'ajeno', name: 'AJENO, LUIS' },
  ];
  const shiftsMap: Record<string, any> = {
    [`navarro_${manana}`]: { employeeId: 'navarro', objectiveId: 'casa', code: 'M', positionName: 'Proveedores', startTime: '07:00', endTime: '15:00' },
    [`galeano_${manana}`]: { employeeId: 'galeano', objectiveId: 'ninos', code: 'M', positionName: 'Rondin', startTime: '07:00', endTime: '15:00' },
    [`alaniz_${dia}`]: { employeeId: 'alaniz', objectiveId: 'casa', code: 'T', positionName: 'Proveedores', startTime: '15:00', endTime: '23:00' },
    [`escobar_${dia}`]: { employeeId: 'escobar', objectiveId: 'ninos', code: 'T', positionName: 'Rondin', startTime: '15:00', endTime: '23:00' },
    [`dominguez_${dia}`]: { employeeId: 'dominguez', objectiveId: 'ninos', code: 'N', positionName: 'Rondin', startTime: '23:00', endTime: '07:00' },
    [`ajeno_${manana}`]: { employeeId: 'ajeno', objectiveId: 'afuera', code: 'M', positionName: 'Otro', startTime: '07:00', endTime: '15:00' },
  };
  const proveedores = {
    positionName: 'Proveedores',
    qty: 1,
    coverageType: '24hs',
    shifts: [{ code: 'N', hours: 8, startTime: '23:00', endTime: '07:00', quantity: 1 }],
  };
  const ctx = {
    gapPositionName: 'Proveedores',
    gapStart: '23:00',
    gapEnd: '07:00',
    positionStructure: [proveedores],
    objectiveIdsPermitidos: ['ninos', 'casa'],
    etiquetaObjetivo: (id: string) => (id === 'ninos' ? 'Niños' : id === 'casa' ? 'Casa Mc' : ''),
  };
  const adel = listEarlyStartCandidates('N', dia, 'casa', employees, shiftsMap, {}, [], ctx);
  assert.deepEqual(adel.map((r) => r.id), ['navarro', 'galeano']);
  assert.equal(adel[0].etiquetaLista, 'NAVARRO · M · Casa Mc');
  assert.equal(adel[1].etiquetaLista, 'GALEANO · M · Niños');
  assert.match(adel[1].textoFila || '', /Niños$/);
  const ext = listExtensionCandidates('N', dia, 'casa', employees, shiftsMap, {}, [], ctx);
  assert.deepEqual(ext.map((r) => r.id), ['alaniz', 'escobar']);
  assert.equal(ext.find((r) => r.id === 'escobar')?.etiquetaLista, 'ESCOBAR · T · Niños');
});
