import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanificacionMovilView } from '@/components/movil/PlanificacionMovilView';
import {
  aplicarCambios,
  candidatosParaHueco,
  conflictosDeAsignacion,
  conflictosDeHorario,
  franjasDe,
  type EmpleadoMovil,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';

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
  assert.equal(html.includes('<table'), false);
  assert.equal(html.includes('DASHBOARD'), false);
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
