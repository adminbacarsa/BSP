import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CronogramaSinPublicarCard, PlanificacionMovilView } from '@/components/movil/PlanificacionMovilView';
import { BarraPublicar, CeldaSheetBody, SelectorObjetivoSheetBody, SemanaEncabezado, SemanaGrilla } from '@/components/movil/PlanificacionSemanaView';
import { buildMovilTheme } from '@/lib/companyTheme';
import { AVISO_MES_SIN_PUBLICAR, mesPublicadoDe, puedeCorregirEnCelular } from '@/lib/movil/planificacionSemana';
import {
  aplicarCambios,
  aplicarCoberturaExistenteMovil,
  candidatosParaHueco,
  conflictosDeAsignacion,
  conflictosDeHorario,
  franjasDe,
  eventoEtiqueta,
  turnoMovilDesdeDoc,
  type EmpleadoMovil,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';
import {
  celdasSemana,
  clientesParaSelector,
  direccionSwipe,
  estructuraSlaDelMes,
  etiquetaSemana,
  eventosSemana,
  filasSemana,
  guardarSeleccion,
  huecoDeCelda,
  huecosSemana,
  leerSeleccion,
  lunesDe,
  mesDeSemana,
  plantelDe,
  semanaAnterior,
  semanaDe,
  semanaSiguiente,
} from '@/lib/movil/planificacionSemana';

function turno(partial: Partial<TurnoMovil> & Pick<TurnoMovil, 'id' | 'employeeId' | 'code' | 'date'>): TurnoMovil {
  return {
    employeeName: partial.employeeId === 'VACANTE' ? 'Vacante' : partial.employeeId,
    objectiveId: 'obj-peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    clientId: 'cli',
    clientName: 'Peaje',
    start: '07:00',
    end: '15:00',
    hours: 8,
    vacante: partial.employeeId === 'VACANTE',
    licencia: partial.code === 'V',
    coveredBy: '',
    franco: partial.code === 'F',
    ...partial,
  };
}

test('una licencia cubierta por Operaciones no se ofrece para cubrir; el parcial sí', () => {
  const baez = turno({ id: 'shift-baez', employeeId: 'baez', code: 'AA', date: '2026-10-07', licencia: true, start: '10:45', end: '12:00', coveredBy: 'LALLANA Fabian Alberto' });
  const views = [{
    id: 'shift-baez',
    employeeId: 'baez',
    employeeName: 'BAEZ, Carlos',
    operacionallyCovered: true,
    coverageStatus: 'COVERED',
    coverageType: 'REF',
    coveredByEmployeeName: 'LALLANA Fabian Alberto',
    resolvedBy: 'OPERACIONES',
  }];
  const cubierto = aplicarCoberturaExistenteMovil([baez], views);
  assert.equal(cubierto[0].coveredBy, 'LALLANA Fabian Alberto');
  assert.equal(huecosSemana([], cubierto), 0);
  assert.equal(franjasDe(cubierto, ['2026-10-07']).find((f) => f.id === 'shift-baez')?.kind, 'ok');

  const parcial = aplicarCoberturaExistenteMovil(
    [{ ...baez, coveredBy: 'LALLANA Fabian Alberto' }],
    [{ ...views[0], operacionallyCovered: false, coverageStatus: 'PARTIAL', coverageType: 'EXTEND' }],
  );
  assert.equal(parcial[0].coveredBy, '');
  assert.equal(huecosSemana([], parcial), 1);
  assert.equal(franjasDe(parcial, ['2026-10-07']).find((f) => f.id === 'shift-baez')?.kind, 'licencia');
});

const dias = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
const PEAJE = { id: 'obj-peaje', name: 'Peaje 9 Norte', clientId: 'cli', clientName: 'Peaje' };

const clientes = [
  { id: 'cli', name: 'Peaje', objetivos: [{ id: 'obj-peaje', name: 'Peaje 9 Norte' }, { id: 'obj-rio', name: 'Río Primero' }] },
  { id: 'cli2', name: 'Banco Sur', objetivos: [{ id: 'obj-banco', name: 'Casa Matriz' }] },
];

const slas = [{
  id: 'sla-1',
  empresaId: 'pruebas_sa',
  clientId: 'cli',
  objectiveId: 'obj-peaje',
  objectiveName: 'Peaje 9 Norte',
  status: 'active',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  positions: [
    { positionName: 'Puesto 1', quantity: 1, coverageType: '24hs', allowedShiftTypes: [{ code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' }, { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' }, { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' }] },
    { positionName: 'Portería', quantity: 1, coverageType: 'diurno', activeDays: ['L', 'M', 'X', 'J', 'V'], allowedShiftTypes: [{ code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' }] },
  ],
}];

function estructuraPeaje(ym = '2026-10') {
  return estructuraSlaDelMes({ slas, empresaId: 'pruebas_sa', scopeEmpresa: false, clientes, clientId: 'cli', objectiveId: 'obj-peaje', ym });
}

test('render 390x844 marca la vacante y no arma una tabla', () => {
  const franjas = franjasDe([
    turno({ id: 'v1', employeeId: 'VACANTE', code: 'T', date: '2026-10-03', start: '15:00', end: '23:00' }),
    turno({ id: 'm1', employeeId: 'baez', employeeName: 'Baez', code: 'M', date: '2026-10-03' }),
  ], dias);
  const html = renderToStaticMarkup(
    <PlanificacionMovilView
      empresa="pruebas_sa"
      online
      pendingLabel={null}
      panel="dias"
      onPanel={() => {}}
      dias={dias}
      dia="2026-10-03"
      franjas={franjas}
      porPublicar={0}
      puedeCorregir={false}
      mesPublicado
      onDia={() => {}}
      onHueco={() => {}}
      onAsignado={() => {}}
      onPublicar={() => {}}
    />,
  );
  assert.match(html, /data-viewport="390x844"/);
  assert.match(html, /max-w-\[390px\]/);
  assert.match(html, /Vacante/);
  assert.match(html, /data-plan-pestana="semana"/);
  assert.equal(html.includes('<table'), false);
  assert.equal(html.includes('DASHBOARD'), false);
  // Sin chips rellenos de color: el código va en recuadro con borde y el estado en texto.
  assert.equal(/bg-(rose|violet|emerald|amber)-\d00 text-white/.test(html), false);
  assert.equal(/rounded-full[^"]*bg-(rose|violet|emerald|amber)/.test(html), false);
});

test('selector cliente → objetivo con buscador y memoria del último', () => {
  const lista = clientesParaSelector(clientes);
  assert.deepEqual(lista.map((c) => c.name), ['Banco Sur', 'Peaje']);
  const html = renderToStaticMarkup(<SelectorObjetivoSheetBody clientes={lista} seleccion={{ clientId: 'cli', objectiveId: 'obj-rio' }} onElegir={() => {}} />);
  assert.match(html, /data-plan-selector="1"/);
  assert.match(html, /aria-label="Buscar cliente u objetivo"/);
  assert.match(html, /data-plan-cliente="cli2"/);
  assert.match(html, /data-plan-objetivo="obj-rio"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-plan-objetivo="obj-rio"/);
  assert.match(html, /Elegido/);
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  guardarSeleccion('pruebas_sa', { clientId: 'cli', objectiveId: 'obj-peaje' }, storage);
  assert.deepEqual(leerSeleccion('pruebas_sa', storage), { clientId: 'cli', objectiveId: 'obj-peaje' });
  assert.equal(leerSeleccion('otra', storage), null);
});

test('semana lun→dom con filas del SLA, celdas guardia + código y huecos marcados', () => {
  const lunes = lunesDe('2026-10-08');
  assert.equal(lunes, '2026-10-05');
  const diasSem = semanaDe(lunes);
  assert.deepEqual([diasSem[0], diasSem[6]], ['2026-10-05', '2026-10-11']);
  assert.equal(etiquetaSemana(lunes), 'Semana 2 de octubre · 5–11');
  // La semana que cruza mes se cuenta en el mes con más días (4 de octubre vs 3 de septiembre).
  assert.equal(etiquetaSemana('2026-09-28'), 'Semana 1 de octubre · 28 sep–4 oct');
  assert.equal(mesDeSemana('2026-09-28'), '2026-10');
  assert.equal(mesDeSemana('2026-11-30'), '2026-12');

  const { estructura, conSla } = estructuraPeaje();
  assert.equal(conSla, true);
  const filas = filasSemana(estructura);
  assert.deepEqual(filas.map((f) => f.id), ['Puesto 1|M', 'Puesto 1|T', 'Puesto 1|N', 'Portería|M']);
  const turnos = [
    turno({ id: 'm1', employeeId: 'baez', employeeName: 'Baez, Juan', code: 'M', date: '2026-10-05' }),
    turno({ id: 't1', employeeId: 'guerrero', employeeName: 'Guerrero', code: 'T', date: '2026-10-05', start: '15:00', end: '23:00' }),
    turno({ id: 'v1', employeeId: 'VACANTE', code: 'N', date: '2026-10-05', start: '23:00', end: '07:00' }),
    turno({ id: 'lic', employeeId: 'fontana', employeeName: 'Fontana', code: 'V', date: '2026-10-06', hours: 0 }),
  ];
  const celdas = celdasSemana(filas, diasSem, turnos, 'obj-peaje');
  assert.equal(celdas[0][0].kind, 'ok');
  assert.equal(celdas[2][0].kind, 'hueco');
  assert.equal(celdas[2][0].faltan, 1);
  assert.equal(celdas[1][1].kind, 'hueco');
  // Portería no opera el sábado ni el domingo.
  assert.equal(celdas[3][5].kind, 'sin-servicio');
  assert.equal(celdas[3][6].cupo, 0);
  const licencias = turnos.filter((t) => t.licencia);
  const total = huecosSemana(celdas, licencias);
  assert.ok(total >= 20, `huecos ${total}`);

  const html = renderToStaticMarkup(
    <SemanaGrilla lunes={lunes} dias={diasSem} hoy="2026-10-08" filas={filas} celdas={celdas} licencias={licencias} onAnterior={() => {}} onSiguiente={() => {}} onCelda={() => {}} onLicencia={() => {}} />,
  );
  assert.match(html, /data-plan-etiqueta="1"[^>]*>Semana 2 de octubre · 5–11</);
  assert.match(html, /grid-cols-7/);
  assert.match(html, /data-plan-celda="Puesto 1\|M\|2026-10-05"[^>]*data-plan-estado="ok"/);
  assert.match(html, />BAEZ</);
  assert.match(html, /data-plan-celda="Puesto 1\|N\|2026-10-05"[^>]*data-plan-estado="hueco"/);
  assert.match(html, /data-plan-fila="licencias"/);
  assert.match(html, /s\/cubrir/);
  assert.equal(html.includes('<table'), false);
  assert.equal((html.match(/data-plan-fila="/g) || []).length, 5);

  const encabezado = renderToStaticMarkup(<SemanaEncabezado clienteNombre="Peaje" objetivoNombre="Peaje 9 Norte" onSelector={() => {}} publicado={false} huecos={total} cambios={2} mesLabel="octubre" />);
  assert.match(encabezado, /data-plan-estado-mes="Sin publicar"/);
  assert.match(encabezado, /text-amber-600[^>]*>Sin publicar</);
  assert.match(encabezado, /data-plan-cambios="2"/);
});

test('swipe: izquierda = semana siguiente, derecha = anterior, vertical no cambia', () => {
  assert.equal(direccionSwipe(-80, 10), 'siguiente');
  assert.equal(direccionSwipe(90, -5), 'anterior');
  assert.equal(direccionSwipe(-30, 0), null);
  assert.equal(direccionSwipe(-80, 120), null);
  assert.equal(semanaSiguiente('2026-10-05'), '2026-10-12');
  assert.equal(semanaAnterior('2026-10-05'), '2026-09-28');
  assert.equal(etiquetaSemana(semanaSiguiente(semanaSiguiente('2026-10-05'))), 'Semana 4 de octubre · 19–25');
});

test('asignar desde la celda: hueco del SLA sin doc nace como turno nuevo y borrar lo saca', () => {
  const { estructura } = estructuraPeaje();
  const filas = filasSemana(estructura);
  const diasSem = semanaDe('2026-10-05');
  const turnos = [turno({ id: 'm1', employeeId: 'baez', employeeName: 'Baez', code: 'M', date: '2026-10-05' })];
  const celdaN = celdasSemana(filas, diasSem, turnos, 'obj-peaje')[2][0];
  assert.equal(celdaN.kind, 'hueco');
  const hueco = huecoDeCelda(celdaN, PEAJE);
  assert.match(hueco.id, /^slot:/);
  assert.equal(hueco.start, '23:00');
  const hoja = renderToStaticMarkup(<CeldaSheetBody celda={celdaN} onGuardia={() => {}} onCubrir={() => {}} />);
  assert.match(hoja, /data-plan-cubrir="1"/);
  assert.match(hoja, /Cubrir el hueco/);

  const empleados: EmpleadoMovil[] = [{ id: 'guerrero', name: 'Guerrero', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40 }];
  const candidatos = candidatosParaHueco({ hueco, empleados, turnos, objLat: -31.4, objLng: -64.18 });
  assert.equal(candidatos[0]?.blocked, false);
  const conNuevo = aplicarCambios(turnos, [{ kind: 'nuevo', franja: hueco, employeeId: 'guerrero', employeeName: 'Guerrero', ft: false }]);
  const celdas2 = celdasSemana(filas, diasSem, conNuevo, 'obj-peaje');
  assert.equal(celdas2[2][0].kind, 'ok');
  assert.equal(celdas2[2][0].guardias[0]?.employeeName, 'Guerrero');
  const borrado = aplicarCambios(conNuevo, [{ kind: 'borrar', franjaId: 'm1' }]);
  assert.equal(borrado.some((t) => t.id === 'm1'), false);
  assert.equal(celdasSemana(filas, diasSem, borrado, 'obj-peaje')[0][0].kind, 'hueco');
});

test('asignar en dos pasos deja a Guerrero en el hueco y bloquea el descanso de 12 h', () => {
  const hueco = franjasDe([
    turno({ id: 'v1', employeeId: 'VACANTE', code: 'M', date: '2026-10-03', start: '07:00', end: '15:00' }),
    turno({ id: 't1', employeeId: 'baez', employeeName: 'Baez', code: 'T', date: '2026-10-02', start: '15:00', end: '23:00' }),
    turno({ id: 'f1', employeeId: 'fontana', employeeName: 'Fontana', code: 'F', date: '2026-10-03', start: '00:00', end: '23:59', hours: 0, franco: true }),
  ], ['2026-10-02', ...dias]).find((f) => f.id === 'v1');
  if (!hueco) throw new Error('falta el hueco');
  const empleados: EmpleadoMovil[] = [
    { id: 'guerrero', name: 'Guerrero', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40 },
    { id: 'baez', name: 'Baez', preferredObjectiveId: 'obj-peaje', lat: -31.41, lng: -64.19, monthHours: 80 },
    { id: 'fontana', name: 'Fontana', preferredObjectiveId: 'obj-peaje', lat: -31.42, lng: -64.2, monthHours: 0 },
  ];
  const turnos = [
    turno({ id: 'v1', employeeId: 'VACANTE', code: 'M', date: '2026-10-03', start: '07:00', end: '15:00' }),
    turno({ id: 't1', employeeId: 'baez', employeeName: 'Baez', code: 'T', date: '2026-10-02', start: '15:00', end: '23:00' }),
    turno({ id: 'f1', employeeId: 'fontana', employeeName: 'Fontana', code: 'F', date: '2026-10-03', start: '00:00', end: '23:59', hours: 0, franco: true }),
  ];
  const candidatos = candidatosParaHueco({ hueco, empleados, turnos, objLat: -31.4, objLng: -64.18 });
  const guerrero = candidatos.find((c) => c.employeeId === 'guerrero');
  const baez = candidatos.find((c) => c.employeeId === 'baez');
  const fontana = candidatos.find((c) => c.employeeId === 'fontana');
  assert.equal(guerrero?.blocked, false);
  assert.equal(guerrero?.tab, 'plantel');
  assert.equal(baez?.blocked, true);
  assert.match(baez?.reason || '', /12 h/);
  assert.equal(fontana?.tab, 'ft');
  const cubierto = aplicarCambios(turnos, [{ kind: 'asignar', franjaId: 'v1', employeeId: 'guerrero', employeeName: 'Guerrero', ft: false }]);
  assert.equal(cubierto.find((t) => t.id === 'v1')?.employeeName, 'Guerrero');
  assert.equal(cubierto.find((t) => t.id === 'v1')?.vacante, false);
});

test('un horario que se superpone o pasa 12:59 queda bloqueado', () => {
  const manana = turno({ id: 'm1', employeeId: 'chavero', employeeName: 'Chavero', code: 'M', date: '2026-10-03' });
  const tarde = turno({ id: 't1', employeeId: 'chavero', employeeName: 'Chavero', code: 'T', date: '2026-10-03', start: '15:00', end: '23:00' });
  const superpuesto = conflictosDeHorario(tarde, 'M', '07:00', '15:00', 8, [manana, tarde]);
  assert.equal(superpuesto.blocked, true);
  assert.match(superpuesto.reason || '', /superpone/i);
  const tope = conflictosDeAsignacion({
    employeeId: 'fantini',
    employeeName: 'Fantini',
    fecha: '2026-10-03',
    start: '07:00',
    end: '20:30',
    hours: 13.5,
    code: 'D12',
    objectiveId: 'obj-peaje',
    monthHours: 0,
    otrosTurnos: [],
  });
  assert.equal(tope.blocked, true);
  assert.match(tope.reason || '', /12:59/);
});

test('el celular no publica meses ni guarda borradores: solo lectura sin publicar, corrección con correct', () => {
  // Mes sin publicar: aviso fijo, sin botón de publicar aunque haya permiso o cambios.
  const sinPublicar = renderToStaticMarkup(<BarraPublicar cambios={0} publicado={false} puedeCorregir onGuardar={() => {}} />);
  assert.match(sinPublicar, /data-plan-solo-lectura="1"/);
  assert.ok(sinPublicar.includes(AVISO_MES_SIN_PUBLICAR));
  assert.equal(sinPublicar.includes('data-plan-publicar'), false);
  assert.equal(sinPublicar.includes('Publicar octubre'), false);
  assert.equal(sinPublicar.includes('borrador'), false);
  const sinPublicarConCambios = renderToStaticMarkup(<BarraPublicar cambios={2} publicado={false} puedeCorregir onGuardar={() => {}} />);
  assert.equal(sinPublicarConCambios.includes('data-plan-publicar'), false);
  // Mes publicado: corrección con permiso `correct`; sin cambios, nada.
  const publicadoSinCambios = renderToStaticMarkup(<BarraPublicar cambios={0} publicado puedeCorregir onGuardar={() => {}} />);
  assert.equal(publicadoSinCambios, '');
  const correccion = renderToStaticMarkup(<BarraPublicar cambios={3} publicado puedeCorregir onGuardar={() => {}} />);
  assert.match(correccion, /data-plan-publicar="correccion"[^>]*>Publicar corrección · 3 cambios</);
  const sinPermiso = renderToStaticMarkup(<BarraPublicar cambios={1} publicado puedeCorregir={false} onGuardar={() => {}} />);
  assert.match(sinPermiso, /data-plan-publicar="correccion"[^>]*disabled/);
  assert.match(sinPermiso, /Falta permiso para corregir/);
  // Gate de edición: solo mes publicado + correct.
  assert.deepEqual(puedeCorregirEnCelular(true, true), { ok: true, motivo: null });
  assert.equal(puedeCorregirEnCelular(false, true).motivo, AVISO_MES_SIN_PUBLICAR);
  assert.equal(puedeCorregirEnCelular(null, true).motivo, AVISO_MES_SIN_PUBLICAR);
  assert.match(puedeCorregirEnCelular(true, false).motivo || '', /permiso/);
  assert.equal(mesPublicadoDe({ 'obj-peaje|2026-10': { publishedAt: true, publishedBy: 'x' } }, 'obj-peaje', '2026-10-05'), true);
  assert.equal(mesPublicadoDe({ 'obj-peaje|2026-10': { publishedAt: true, publishedBy: 'x' } }, 'obj-peaje', '2026-11-01'), null);
});

test('render celular: semana con mes publicado vs sin publicar', () => {
  const { estructura } = estructuraPeaje();
  const filas = filasSemana(estructura);
  const diasSem = semanaDe('2026-10-05');
  const turnos = [turno({ id: 'm1', employeeId: 'baez', employeeName: 'Baez', code: 'M', date: '2026-10-05' })];
  const celdas = celdasSemana(filas, diasSem, turnos, 'obj-peaje');
  const celdaN = celdas[2][0];
  const celdaM = celdas[0][0];
  // Publicado: la celda ofrece cubrir y los guardias se pueden tocar.
  const editable = renderToStaticMarkup(<CeldaSheetBody celda={celdaN} onGuardia={() => {}} onCubrir={() => {}} />);
  assert.match(editable, /data-plan-cubrir="1"/);
  assert.equal(editable.includes('data-plan-celda-solo-lectura'), false);
  const editableM = renderToStaticMarkup(<CeldaSheetBody celda={celdaM} onGuardia={() => {}} onCubrir={() => {}} />);
  assert.match(editableM, /<button[^>]*data-plan-guardia="m1"/);
  assert.match(editableM, />Baez</);
  // Sin publicar: solo lectura, con el aviso y sin acciones.
  const soloLectura = renderToStaticMarkup(<CeldaSheetBody celda={celdaN} soloLectura onGuardia={() => {}} onCubrir={() => {}} />);
  assert.match(soloLectura, /data-plan-celda-solo-lectura="1"/);
  assert.equal(soloLectura.includes('data-plan-cubrir'), false);
  assert.ok(soloLectura.includes(AVISO_MES_SIN_PUBLICAR));
  assert.match(soloLectura, /hueco sin cubrir/i);
  const soloLecturaM = renderToStaticMarkup(<CeldaSheetBody celda={celdaM} soloLectura onGuardia={() => {}} onCubrir={() => {}} />);
  assert.equal(soloLecturaM.includes('<button'), false);
  assert.match(soloLecturaM, />Baez</);
  // Encabezado: Publicado vs Sin publicar.
  const pub = renderToStaticMarkup(<SemanaEncabezado clienteNombre="Peaje" objetivoNombre="Peaje 9 Norte" onSelector={() => {}} publicado huecos={0} cambios={0} mesLabel="octubre" />);
  assert.match(pub, /data-plan-estado-mes="Publicado"/);
  const noPub = renderToStaticMarkup(<SemanaEncabezado clienteNombre="Peaje" objetivoNombre="Peaje 9 Norte" onSelector={() => {}} publicado={false} huecos={0} cambios={0} mesLabel="octubre" />);
  assert.match(noPub, /data-plan-estado-mes="Sin publicar"/);
  assert.equal(noPub.includes('Borrador'), false);
  // Próximos días con mes sin publicar: aviso y sin botón de publicar.
  const dias2 = renderToStaticMarkup(
    <PlanificacionMovilView
      empresa="pruebas_sa"
      online
      pendingLabel={null}
      panel="dias"
      onPanel={() => {}}
      dias={dias}
      dia="2026-10-03"
      franjas={[]}
      porPublicar={0}
      puedeCorregir
      mesPublicado={false}
      onDia={() => {}}
      onHueco={() => {}}
      onAsignado={() => {}}
      onPublicar={() => {}}
    />,
  );
  assert.match(dias2, /data-plan-solo-lectura="dias"/);
  assert.ok(dias2.includes(AVISO_MES_SIN_PUBLICAR));
  assert.equal(dias2.includes('data-plan-publicar'), false);
  // La alerta de cronograma sin publicar abre la semana («Ver semana»), no publica.
  const grupo = {
    mesKey: '2026-10',
    mesLabel: 'octubre',
    items: [{ id: 'a1', objectiveId: 'obj-peaje', objectiveName: 'Peaje 9 Norte', clientId: 'cli', clientName: 'Peaje', year: 2026, month: 10, cortaManana: true, corteHm: '07:00', linkPublicar: '/admin/planificacion/?objectiveId=obj-peaje&clientId=cli&year=2026&month=10' }],
  } as unknown as Parameters<typeof CronogramaSinPublicarCard>[0]['grupo'];
  const tarjeta = renderToStaticMarkup(<CronogramaSinPublicarCard grupo={grupo} abiertoInicial onVista={() => {}} onAbrir={() => {}} />);
  assert.match(tarjeta, /data-cronograma-abrir="obj-peaje"[^>]*>Ver semana</);
  assert.equal(tarjeta.includes('data-cronograma-publicar'), false);
  assert.equal(/>Publicar</.test(tarjeta), false);
});

test('el mismo markup para dos empresas de colores distintos', () => {
  const render = (empresa: string) => renderToStaticMarkup(
    <PlanificacionMovilView
      empresa={empresa}
      online
      pendingLabel={null}
      panel="semana"
      onPanel={() => {}}
      semana={<SemanaEncabezado clienteNombre="Peaje" objetivoNombre="Peaje 9 Norte" onSelector={() => {}} publicado huecos={0} cambios={1} mesLabel="octubre" />}
      dias={dias}
      dia="2026-10-03"
      franjas={[]}
      porPublicar={0}
      puedeCorregir={false}
      mesPublicado
      onDia={() => {}}
      onHueco={() => {}}
      onAsignado={() => {}}
      onPublicar={() => {}}
    />,
  );
  const azul = buildMovilTheme('#1d4ed8');
  const amarillo = buildMovilTheme('#fde047');
  assert.notEqual(azul['--movil-topbar'], amarillo['--movil-topbar']);
  assert.notEqual(azul['--movil-primary'], '#fde047');
  assert.notEqual(amarillo['--movil-primary'], '#fde047', 'color claro: el primario usa el tono oscuro para contraste AA');
  const a = render('Bacar SA');
  const b = render('Norte Seguridad');
  assert.equal(a.replaceAll('Bacar SA', 'Norte Seguridad'), b, 'el color de la empresa entra solo por variables CSS');
  assert.match(a, /bg-\[var\(--movil-topbar,#111827\)\]/);
  assert.match(a, /bg-\[var\(--movil-primary,#111827\)\]/);
  assert.match(a, /text-\[var\(--movil-primary-text,#ffffff\)\]/);
  assert.match(a, /text-emerald-600[^>]*>Publicado</, 'el estado conserva su color semántico');
  assert.equal(/bg-\[#(1d4ed8|fde047)\]/.test(a), false);
});

test('puntaje desempata dentro de la misma distancia y no salta un bloqueado', () => {
  const hueco = franjasDe([
    turno({ id: 'v1', employeeId: 'VACANTE', code: 'M', date: '2026-10-03', start: '07:00', end: '15:00' }),
  ], ['2026-10-02', ...dias]).find((f) => f.id === 'v1');
  if (!hueco) throw new Error('falta el hueco');
  const empleados: EmpleadoMovil[] = [
    { id: 'ana', name: 'Ana', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40, puntaje: 40 },
    { id: 'zoe', name: 'Zoe', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40, puntaje: 90 },
  ];
  const turnos = [turno({ id: 'v1', employeeId: 'VACANTE', code: 'M', date: '2026-10-03', start: '07:00', end: '15:00' })];
  const candidatos = candidatosParaHueco({ hueco, empleados, turnos, objLat: -31.4, objLng: -64.18 });
  assert.equal(candidatos[0]?.employeeId, 'zoe');
  assert.equal(candidatos[1]?.employeeId, 'ana');
});

test('evento en la semana: el EV del servidor se ve en el objetivo de base del guardia, solo lectura', () => {
  // EV tal como lo escribe `camposTurnoEvento`: origin EVENTO, objectiveId del evento, sábado 3/10 20:00–02:00 AR.
  const ts = (iso: string) => ({ toDate: () => new Date(iso), seconds: Math.floor(Date.parse(iso) / 1000) });
  const evDoc = turnoMovilDesdeDoc('ev1', {
    code: 'EV', origin: 'EVENTO', eventoId: 'evt_recital', eventoNombre: 'Recital Plaza', servicioId: 'srv', servicioNombre: 'Acceso general',
    positionName: 'Acceso general', objectiveId: 'obj_evento', objectiveName: 'Plaza', employeeId: 'baez', employeeName: 'Baez',
    startTime: ts('2026-10-03T23:00:00.000Z'), endTime: ts('2026-10-04T05:00:00.000Z'), scheduleDate: '2026-10-03', hours: 6,
  });
  if (!evDoc) throw new Error('el EV no se convirtió');
  assert.deepEqual(evDoc.evento, { nombre: 'Recital Plaza', servicio: 'Acceso general' });
  assert.equal(evDoc.start, '20:00');
  assert.equal(eventoEtiqueta(evDoc), 'Recital Plaza · Acceso general · 20:00–02:00');
  const francoDoc = turnoMovilDesdeDoc('f1', { code: 'F', isFranco: true, objectiveId: 'obj-peaje', employeeId: 'baez', employeeName: 'Baez', scheduleDate: '2026-10-03', startTime: '00:00', endTime: '23:59', coverageUsed: true });
  assert.equal(francoDoc?.francoUsado, true);

  const { estructura } = estructuraPeaje();
  const filas = filasSemana(estructura);
  const diasSem = semanaDe('2026-09-28');
  const turnos = [
    evDoc,
    turno({ id: 'f1', employeeId: 'baez', employeeName: 'Baez', code: 'F', date: '2026-10-03', start: '00:00', end: '23:59', hours: 0 }),
    turno({ id: 'm1', employeeId: 'baez', employeeName: 'Baez', code: 'M', date: '2026-10-01' }),
    turno({ id: 'g1', employeeId: 'guerrero', employeeName: 'Guerrero', code: 'T', date: '2026-10-01', start: '15:00', end: '23:00' }),
  ];
  // El EV no entra en las celdas del SLA (objetivo del evento ≠ Peaje) …
  const celdas = celdasSemana(filas, diasSem, turnos, 'obj-peaje');
  assert.equal(celdas.flat().some((c) => c.guardias.some((g) => g.id === 'ev1')), false);
  // … pero el plantel de Peaje lo ve en la fila Eventos, con el franco usado.
  const plantel = plantelDe(turnos, 'obj-peaje', [{ id: 'fontana', preferredObjectiveId: 'obj-peaje' }]);
  assert.deepEqual([...plantel].sort(), ['baez', 'fontana', 'guerrero']);
  const eventos = eventosSemana(diasSem, turnos, plantel);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].francoUsado, true);
  assert.deepEqual(eventosSemana(diasSem, turnos, new Set(['otro'])), [], 'un guardia que no es del plantel no aparece');
  const html = renderToStaticMarkup(
    <SemanaGrilla lunes="2026-09-28" dias={diasSem} hoy="2026-10-01" filas={filas} celdas={celdas} licencias={[]} eventos={eventos} onAnterior={() => {}} onSiguiente={() => {}} onCelda={() => {}} onLicencia={() => {}} />,
  );
  assert.match(html, /data-plan-fila="eventos"/);
  assert.match(html, /data-plan-evento="ev1"[^>]*data-plan-evento-franco="1"[^>]*title="Recital Plaza · Acceso general · 20:00–02:00"/);
  assert.match(html, />BAEZ</);
  assert.match(html, />EV · F usado</);
  assert.equal(/data-plan-evento="ev1"[^>]*<button/.test(html), false, 'solo lectura: no es botón');
  const sinEventos = renderToStaticMarkup(
    <SemanaGrilla lunes="2026-09-28" dias={diasSem} hoy="2026-10-01" filas={filas} celdas={celdas} licencias={[]} onAnterior={() => {}} onSiguiente={() => {}} onCelda={() => {}} onLicencia={() => {}} />,
  );
  assert.equal(sinEventos.includes('data-plan-fila="eventos"'), false);
});

test('conflicto con el evento: el EV cuenta como turno para solape, descanso 12 h y candidatos', () => {
  const ts = (iso: string) => ({ toDate: () => new Date(iso), seconds: Math.floor(Date.parse(iso) / 1000) });
  const evDoc = turnoMovilDesdeDoc('ev1', {
    code: 'EV', origin: 'EVENTO', eventoNombre: 'Recital Plaza', servicioNombre: 'Acceso general', objectiveId: 'obj_evento', objectiveName: 'Plaza',
    employeeId: 'baez', employeeName: 'Baez', startTime: ts('2026-10-03T23:00:00.000Z'), endTime: ts('2026-10-04T05:00:00.000Z'), scheduleDate: '2026-10-03', hours: 6,
  });
  if (!evDoc) throw new Error('el EV no se convirtió');
  const base = { employeeId: 'baez', employeeName: 'Baez', fecha: '2026-10-03', code: 'T', objectiveId: 'obj-peaje', objectiveName: 'Peaje 9 Norte', monthHours: 40, otrosTurnos: [evDoc] };
  const solape = conflictosDeAsignacion({ ...base, start: '15:00', end: '23:00', hours: 8 });
  assert.equal(solape.blocked, true);
  assert.match(solape.reason || '', /Se superpone con el evento Recital Plaza · Acceso general · 20:00–02:00/);
  const descanso = conflictosDeAsignacion({ ...base, code: 'M', start: '07:00', end: '15:00', hours: 8 });
  assert.equal(descanso.blocked, true);
  assert.match(descanso.reason || '', /12 h|descanso/i);
  const lejos = conflictosDeAsignacion({ ...base, fecha: '2026-10-05', code: 'M', start: '07:00', end: '15:00', hours: 8 });
  assert.equal(lejos.blocked, false);
  // Candidatos para un hueco T de Peaje ese día: Baez (en el evento) no aparece; Guerrero sí.
  const hueco = franjasDe([turno({ id: 'v1', employeeId: 'VACANTE', code: 'T', date: '2026-10-03', start: '15:00', end: '23:00' })], dias).find((f) => f.id === 'v1');
  if (!hueco) throw new Error('falta el hueco');
  const empleados: EmpleadoMovil[] = [
    { id: 'baez', name: 'Baez', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40 },
    { id: 'guerrero', name: 'Guerrero', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40 },
  ];
  const turnos = [evDoc, turno({ id: 'v1', employeeId: 'VACANTE', code: 'T', date: '2026-10-03', start: '15:00', end: '23:00' })];
  const candidatos = candidatosParaHueco({ hueco, empleados, turnos, objLat: -31.4, objLng: -64.18 });
  assert.deepEqual(candidatos.map((c) => c.employeeId), ['guerrero']);
  // Hueco M del mismo día: Baez aparece bloqueado por descanso con el evento.
  const huecoM = franjasDe([turno({ id: 'v2', employeeId: 'VACANTE', code: 'M', date: '2026-10-03' })], dias).find((f) => f.id === 'v2');
  if (!huecoM) throw new Error('falta el hueco M');
  const candM = candidatosParaHueco({ hueco: huecoM, empleados, turnos: [evDoc, turno({ id: 'v2', employeeId: 'VACANTE', code: 'M', date: '2026-10-03' })], objLat: -31.4, objLng: -64.18 });
  const baezM = candM.find((c) => c.employeeId === 'baez');
  assert.equal(baezM?.blocked, true);
});