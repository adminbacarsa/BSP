import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acreditacionCierreElegido,
  acreditaCoberturaAlObjetivo,
  bandasAbiertasDelGrupo,
  cierreContado,
  conteosCierreObjetivo,
  cuposCierrePorObjetivo,
  faltanteDeBandaAbierta,
  franjaBandaDeSla,
  motivoBloqueoJornadaCierre,
  objetivoPermitidoParaExtender,
  objectiveIdEscrituraCierre,
  planCerrarBandas,
  textoBotonCerrarBanda,
  textoResultadoCierreBanda,
} from './grupoCerrarBanda';
import { proponerCierre12h, type TurnoPuesto12 } from './cierre12h';
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

test('faltante 2 T cierra las dos bandas y el botón lo dice', () => {
  assert.equal(textoBotonCerrarBanda(2, 'T'), 'CERRAR 2 BANDAS T');
  assert.equal(textoBotonCerrarBanda(1, 'T'), 'CERRAR BANDA T');

  const dia = '2026-10-01';
  const sla = [
    { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
    { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
    { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
    { code: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
    { code: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
  ];
  const turnos: TurnoPuesto12[] = [
    { empId: 'm1', nombre: 'MAÑANA UNO', dateStr: dia, code: 'M', positionName: 'Guardia' },
    { empId: 'm2', nombre: 'MAÑANA DOS', dateStr: dia, code: 'M', positionName: 'Guardia' },
    { empId: 'n1', nombre: 'NOCHE UNO', dateStr: dia, code: 'N', positionName: 'Guardia' },
    { empId: 'n2', nombre: 'NOCHE DOS', dateStr: dia, code: 'N', positionName: 'Guardia' },
  ];
  const parDe = (usados: ReadonlySet<string>) => {
    const prop = proponerCierre12h({
      dateStr: dia,
      positionName: 'Guardia',
      faltantes: ['T'],
      turnos: turnos.filter((t) => !usados.has(t.empId)),
      sla,
      cupos: { GUARDIA: 2 },
    });
    if (!prop || prop.modo !== 'par' || prop.cambios.length < 2) return null;
    return { empIds: prop.cambios.map((c) => c.empId), extra: prop };
  };

  const dosPares = planCerrarBandas({
    banda: 'T',
    faltante: 2,
    asignables: [],
    francos: [],
    par12: parDe,
  });
  assert.equal(dosPares.pasos.length, 2);
  assert.equal(dosPares.quedaron, 0);
  assert.equal(dosPares.pasos.every((p) => p.via === '12h'), true);
  const gente = dosPares.pasos.flatMap((p) => (p.via === '12h' ? p.empIds : []));
  assert.equal(new Set(gente).size, 4);

  const conRet = planCerrarBandas({
    banda: 'T',
    faltante: 2,
    asignables: [{ empId: 'ret1' }],
    francos: [],
    par12: parDe,
  });
  assert.deepEqual(conRet.pasos.map((p) => p.via), ['asignar', '12h']);
  assert.equal(conRet.pasos[0].via === 'asignar' && conRet.pasos[0].empId, 'ret1');
  assert.equal(conRet.quedaron, 0);

  const soloUna = planCerrarBandas({
    banda: 'T',
    faltante: 2,
    asignables: [{ empId: 'ret1' }],
    francos: [],
    par12: () => null,
  });
  assert.equal(soloUna.pasos.length, 1);
  assert.equal(soloUna.quedaron, 1);
  assert.equal(textoResultadoCierreBanda({ banda: 'T', cerradas: 1, quedaron: 1 }), 'Se cerró 1 banda T. Quedó 1 banda T sin cerrar.');
});

const vigilancia = {
  positionName: 'Vigilancia',
  qty: 1,
  coverageType: '24hs',
  shifts: [
    { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00', quantity: 1 },
    { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00', quantity: 1 },
    { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00', quantity: 1 },
  ],
};

test('el par D12+N12 se escribe en el objetivo del hueco y ahí cierra la T', () => {
  assert.equal(objectiveIdEscrituraCierre('vifood', 'peaje'), 'vifood');
  const dia = DIA;
  const base = { dateStr: dia, dayLetter: LETRA, positionName: 'Vigilancia', banda: 'T' };
  const puestosVifood = [{ ...vigilancia, qty: 1 }];
  const antes = bandasAbiertasDelGrupo({
    dateStr: dia,
    dayLetter: LETRA,
    objetivos: [{
      id: 'vifood',
      name: 'Vifood',
      positions: puestosVifood,
      codeCountsByPosition: { Vigilancia: { M: 1, N: 1 } },
    }],
  });
  assert.equal(faltanteDeBandaAbierta(antes, { objectiveId: 'vifood', positionName: 'Vigilancia', band: 'T' }), 1);

  const mal = [
    { objectiveId: 'peaje', positionName: 'Vigilancia', code: 'D12' },
    { objectiveId: 'peaje', positionName: 'Vigilancia', code: 'N12' },
  ];
  const abiertasMal = bandasAbiertasDelGrupo({
    dateStr: dia,
    dayLetter: LETRA,
    objetivos: [{
      id: 'vifood',
      name: 'Vifood',
      positions: puestosVifood,
      codeCountsByPosition: conteosCierreObjetivo('vifood', mal),
    }],
  });
  const faltanteMal = faltanteDeBandaAbierta(abiertasMal, { objectiveId: 'vifood', positionName: 'Vigilancia', band: 'T' });
  assert.equal(faltanteMal, 1);
  assert.deepEqual(cierreContado(1, faltanteMal), { cerradas: 0, quedaron: 1 });

  const bien = mal.map((t) => ({ ...t, objectiveId: objectiveIdEscrituraCierre('vifood', t.objectiveId) }));
  assert.deepEqual(bien.map((t) => t.objectiveId), ['vifood', 'vifood']);
  const abiertasBien = bandasAbiertasDelGrupo({
    dateStr: dia,
    dayLetter: LETRA,
    objetivos: [{
      id: 'vifood',
      name: 'Vifood',
      positions: puestosVifood,
      codeCountsByPosition: conteosCierreObjetivo('vifood', bien),
    }],
  });
  const faltanteBien = faltanteDeBandaAbierta(abiertasBien, { objectiveId: 'vifood', positionName: 'Vigilancia', band: 'T' });
  assert.equal(faltanteBien, 0);
  assert.deepEqual(cierreContado(base.banda === 'T' ? 1 : 0, faltanteBien), { cerradas: 1, quedaron: 0 });
});

test('cerrar la T de Peaje no se lleva una M de Vifood: el cupo es el de cada objetivo', () => {
  const dia = DIA;
  const turnos: TurnoPuesto12[] = [
    { empId: 'mv1', nombre: 'MAÑANA VIFOOD', dateStr: dia, code: 'M', positionName: 'Vigilancia', objectiveId: 'vifood' },
    { empId: 'mv2', nombre: 'MAÑANA VIFOOD 2', dateStr: dia, code: 'M', positionName: 'Vigilancia', objectiveId: 'vifood' },
    { empId: 'np', nombre: 'NOCHE PEAJE', dateStr: dia, code: 'N', positionName: 'Vigilancia', objectiveId: 'peaje' },
  ];
  const sla = vigilancia.shifts;
  const cuposDelSeleccionado = { VIGILANCIA: 1 };
  const cuposDelGrupo = cuposCierrePorObjetivo({
    peaje: [{ positionName: 'Vigilancia', qty: 1 }],
    vifood: [{ positionName: 'Vigilancia', qty: 2 }],
  });
  assert.equal(cuposDelGrupo['vifood|VIGILANCIA'], 2);
  assert.equal(cuposDelGrupo.VIGILANCIA, undefined);

  const mal = proponerCierre12h({
    dateStr: dia,
    positionName: 'Vigilancia',
    faltantes: ['T'],
    turnos,
    sla,
    cupos: cuposDelSeleccionado,
    objectiveId: 'peaje',
  });
  assert.equal(mal?.modo, 'par');
  assert.equal(mal?.cambios.some((c) => c.empId === 'mv1' || c.empId === 'mv2'), true);

  const bien = proponerCierre12h({
    dateStr: dia,
    positionName: 'Vigilancia',
    faltantes: ['T'],
    turnos,
    sla,
    cupos: cuposDelGrupo,
    objectiveId: 'peaje',
  });
  assert.notEqual(bien?.modo, 'par');
  assert.equal(bien?.cambios.some((c) => c.empId === 'mv1' || c.empId === 'mv2'), false);
});

test('el horario de 8 h sale del SLA del objetivo del hueco', () => {
  const peaje = [{ code: 'T', startTime: '14:00', endTime: '22:00', hours: 8, name: 'Tarde' }];
  const vifood = [
    { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, name: 'Tarde' },
    { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12, name: 'D12' },
  ];
  const franja = franjaBandaDeSla(vifood, 'T');
  assert.equal(franja?.startTime, '15:00');
  assert.equal(franja?.endTime, '23:00');
  assert.notEqual(franja?.startTime, franjaBandaDeSla(peaje, 'T')?.startTime);
  assert.equal(franjaBandaDeSla(vifood, 'T')?.code, 'T');
});

test('el par de 12 h y el FT respetan tope, racha de 4 y el descanso del turno ya alargado', () => {
  const dia = '2026-10-09';
  const tope = motivoBloqueoJornadaCierre({
    horasMes: 198,
    horasAntes: 8,
    horasDespues: 12,
    dateStr: dia,
    propuesto: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
  });
  assert.match(tope || '', /tope 200 h/);

  const justo = motivoBloqueoJornadaCierre({
    horasMes: 196,
    horasAntes: 8,
    horasDespues: 12,
    dateStr: dia,
    propuesto: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
  });
  assert.equal(justo, null);

  const ft = motivoBloqueoJornadaCierre({
    horasMes: 196,
    horasAntes: 0,
    horasDespues: 8,
    dateStr: dia,
    propuesto: { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
  });
  assert.match(ft || '', /tope 200 h/);
  assert.equal(motivoBloqueoJornadaCierre({
    horasMes: 196,
    horasAntes: 0,
    horasDespues: 8,
    topeAutorizado: true,
    dateStr: dia,
    propuesto: { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
  }), null);

  const medidoEn8 = motivoBloqueoJornadaCierre({
    horasMes: 40,
    horasAntes: 8,
    horasDespues: 8,
    dateStr: dia,
    propuesto: { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
    siguiente: { code: 'M', startTime: '06:00', endTime: '14:00' },
  });
  assert.equal(medidoEn8, null);
  const alargado = motivoBloqueoJornadaCierre({
    horasMes: 40,
    horasAntes: 8,
    horasDespues: 12,
    dateStr: dia,
    propuesto: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
    siguiente: { code: 'M', startTime: '06:00', endTime: '14:00' },
  });
  assert.match(alargado || '', /descanso/);

  const racha = motivoBloqueoJornadaCierre({
    horasMes: 40,
    horasAntes: 8,
    horasDespues: 12,
    dateStr: dia,
    propuesto: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
    dias12: ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-10'],
  });
  assert.match(racha || '', /12 h seguidos/);
  assert.equal(motivoBloqueoJornadaCierre({
    horasMes: 40,
    horasAntes: 8,
    horasDespues: 12,
    dateStr: dia,
    propuesto: { code: 'D12', startTime: '07:00', endTime: '19:00', hours: 12 },
    dias12: ['2026-10-06', '2026-10-07', '2026-10-08'],
  }), null);
});
