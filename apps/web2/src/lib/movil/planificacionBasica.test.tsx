import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanificacionMovilView } from '@/components/movil/PlanificacionMovilView';
import { BarraPublicar, CeldaSheetBody, SelectorObjetivoSheetBody, SemanaEncabezado, SemanaGrilla } from '@/components/movil/PlanificacionSemanaView';
import { buildMovilTheme } from '@/lib/companyTheme';
import {
  aplicarCambios,
  candidatosParaHueco,
  conflictosDeAsignacion,
  conflictosDeHorario,
  franjasDe,
  type EmpleadoMovil,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';
import {
  celdasSemana,
  clientesParaSelector,
  direccionSwipe,
  estructuraSlaDelMes,
  etiquetaSemana,
  filasSemana,
  guardarSeleccion,
  huecoDeCelda,
  huecosSemana,
  leerSeleccion,
  lunesDe,
  mesDeSemana,
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
      puedePublicar={false}
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
  assert.match(encabezado, /data-plan-estado-mes="Borrador"/);
  assert.match(encabezado, /text-amber-600[^>]*>Borrador</);
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

test('publicar: borrador con publish, corrección con correct; el mismo markup para dos empresas de colores distintos', () => {
  const borrador = renderToStaticMarkup(<BarraPublicar cambios={0} publicado={false} puedeEditar puedeCorregir={false} puedePublicar mesLabel="octubre" onGuardar={() => {}} onPublicarMes={() => {}} />);
  assert.match(borrador, /data-plan-publicar="publicar"[^>]*>Publicar octubre</);
  const sinPermiso = renderToStaticMarkup(<BarraPublicar cambios={0} publicado={false} puedeEditar puedeCorregir={false} puedePublicar={false} mesLabel="octubre" onGuardar={() => {}} onPublicarMes={() => {}} />);
  assert.equal(sinPermiso, '');
  const correccion = renderToStaticMarkup(<BarraPublicar cambios={3} publicado puedeEditar puedeCorregir puedePublicar={false} mesLabel="octubre" onGuardar={() => {}} onPublicarMes={() => {}} />);
  assert.match(correccion, /data-plan-publicar="correccion"[^>]*>Publicar corrección · 3 cambios</);
  const guardar = renderToStaticMarkup(<BarraPublicar cambios={1} publicado={false} puedeEditar puedeCorregir={false} puedePublicar mesLabel="octubre" onGuardar={() => {}} onPublicarMes={() => {}} />);
  assert.match(guardar, /data-plan-publicar="borrador"[^>]*>Guardar borrador · 1 cambio</);

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
      puedePublicar={false}
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
