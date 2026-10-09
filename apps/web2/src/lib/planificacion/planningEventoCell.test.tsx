import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eventoAssignBlock,
  eventoCellOverlay,
  eventoTooltip,
  pickEventoTurno,
  textoTooltipEventoCelda,
  pickShiftForRest,
} from '@/lib/planificacion/planningEventoCell';

const ts = (iso: string) => ({ toDate: () => new Date(iso), seconds: Math.floor(Date.parse(iso) / 1000) });

/** EV escrito por el servidor (`camposTurnoEvento`): sábado 03/10 20:00–02:00 AR. */
const ev = {
  id: 'ev1',
  code: 'EV',
  origin: 'EVENTO',
  eventoId: 'evt_recital',
  eventoNombre: 'Recital Plaza',
  servicioId: 'srv_acceso',
  servicioNombre: 'Acceso general',
  positionName: 'Acceso general',
  objectiveId: 'obj_evento',
  employeeId: 'baez',
  startTime: ts('2026-10-03T23:00:00.000Z'),
  endTime: ts('2026-10-04T05:00:00.000Z'),
};
const franco = { id: 'f1', code: 'F', isFranco: true, objectiveId: 'obj-peaje', employeeId: 'baez', coverageUsed: true };
const manana = { id: 'm1', code: 'M', objectiveId: 'obj-peaje', employeeId: 'baez', startTime: ts('2026-10-03T10:00:00.000Z'), endTime: ts('2026-10-03T18:00:00.000Z') };

test('tooltip de la celda: una línea «Evento: {evento} · {servicio} · horario», después lugar y alertas', () => {
  assert.equal(
    textoTooltipEventoCelda({ ev }),
    'Evento: Recital Plaza · Acceso general · 20:00–02:00',
  );
  assert.equal(
    textoTooltipEventoCelda({
      ev,
      lugar: 'Hospital de Niños',
      alertas: ['Art. 197 LCT: M 15:00 → EV 08:00 = 11 h (mín. 12 h)'],
    }),
    'Evento: Recital Plaza · Acceso general · 20:00–02:00\nHospital de Niños\nArt. 197 LCT: M 15:00 → EV 08:00 = 11 h (mín. 12 h)',
  );
  assert.equal(
    textoTooltipEventoCelda({ ev, mode: 'FRANCO_USADO', lugar: 'Acceso general' }),
    'Evento: Recital Plaza · Acceso general · 20:00–02:00\nFranco usado en evento',
    'el lugar que repite el servicio no se duplica',
  );
  assert.equal(
    textoTooltipEventoCelda({ ev, mode: 'BADGE', lugar: 'Peaje Norte' }),
    'Evento: Recital Plaza · Acceso general · 20:00–02:00\nTambién afectado al evento\nPeaje Norte',
  );
  assert.equal(
    textoTooltipEventoCelda({ ev: { ...ev, eventoNombre: '', servicioNombre: '', positionName: 'Puerta 3' } }),
    'Evento: Evento · Puerta 3 · 20:00–02:00',
  );
});

test('tooltip «{evento} · {servicio} · HH:MM–HH:MM» en hora Argentina', () => {
  assert.equal(eventoTooltip(ev), 'Recital Plaza · Acceso general · 20:00–02:00');
  assert.equal(eventoTooltip({ ...ev, eventoNombre: '', servicioNombre: '', positionName: 'Puerta 3' }), 'Evento · Puerta 3 · 20:00–02:00');
  assert.equal(pickEventoTurno([franco, ev])?.id, 'ev1');
  assert.equal(pickEventoTurno([franco, { ...ev, isDeleted: true }]), null);
  assert.equal(pickEventoTurno([{ ...manana, eventoId: 'evt_recital' }]), null, 'un M con eventoId suelto no es EV');
});

test('celda del guardia en su objetivo de base: EV, franco usado o marca sobre otro turno', () => {
  // Solo el EV ese día (el doc principal de la celda es el EV de otro objetivo o no hay doc).
  assert.equal(eventoCellOverlay([ev], ev)?.mode, 'EV');
  assert.equal(eventoCellOverlay([ev], null)?.mode, 'EV');
  // Venía de franco: la celda sigue siendo F, marcada como usada, cualquiera sea el doc principal.
  const desdeFranco = eventoCellOverlay([franco, ev], franco);
  assert.equal(desdeFranco?.mode, 'FRANCO_USADO');
  assert.equal(desdeFranco?.franco?.id, 'f1');
  assert.equal(eventoCellOverlay([ev, franco], ev)?.mode, 'FRANCO_USADO', 'último doc = EV: el franco igual se muestra como usado');
  assert.equal(desdeFranco?.tooltip, 'Recital Plaza · Acceso general · 20:00–02:00');
  // Tiene un M en el objetivo y además el EV: marca visible sobre la celda.
  assert.equal(eventoCellOverlay([manana, ev], manana)?.mode, 'BADGE');
  // Sin EV no hay nada.
  assert.equal(eventoCellOverlay([manana], manana), null);
  assert.equal(eventoCellOverlay(undefined, null), null);
});

test('descanso entre turnos: el EV cuenta aunque el doc principal del día sea un franco', () => {
  assert.equal(pickShiftForRest(franco, [franco, ev])?.id, 'ev1');
  assert.equal(pickShiftForRest(null, [ev])?.id, 'ev1');
  assert.equal(pickShiftForRest(manana, [manana, ev])?.id, 'm1');
  assert.equal(pickShiftForRest(franco, [franco])?.id, 'f1');
});

test('no asignarlo dos veces: solape, descanso 12 h y mismo evento; francos y licencias pasan', () => {
  const cell = [franco, ev];
  // T 15–23 se pisa con el evento 20–02.
  assert.match(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'T', start: '15:00', end: '23:00' } }) || '', /se superpone con el evento/);
  // N 23–07 arranca cuando el evento sigue → solape.
  assert.match(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'N', start: '23:00', end: '07:00' } }) || '', /se superpone/);
  // M 07–15 termina a las 15, el evento empieza 20: 5 h de descanso → bloqueado.
  assert.match(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'M', start: '07:00', end: '15:00' } }) || '', /menos de 12 h de descanso.*5 h/);
  // Turno temprano 00–07 del mismo día: 13 h antes del evento → permitido.
  assert.equal(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'PU', start: '00:00', end: '07:00' } }), null);
  // Sin horario conocido se bloquea el día entero.
  assert.match(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'RET' } }) || '', /afectado al evento/);
  // Mismo evento otra vez = duplicado; otro evento sin pisarse pasa por horario.
  assert.match(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'EV', start: '20:00', end: '02:00', eventoId: 'evt_recital', servicioId: 'srv_acceso' } }) || '', /ya está asignado a ese evento/);
  assert.match(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'EV', start: '21:00', end: '23:00', eventoId: 'evt_otro' } }) || '', /se superpone/);
  // Franco y licencias no se bloquean (el franco es el origen del EV; la licencia la carga RRHH).
  assert.equal(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'F' } }), null);
  assert.equal(eventoAssignBlock({ cellTurnos: cell, dateStr: '2026-10-03', proposed: { code: 'E' } }), null);
  // Sin EV, nada.
  assert.equal(eventoAssignBlock({ cellTurnos: [franco], dateStr: '2026-10-03', proposed: { code: 'T', start: '15:00', end: '23:00' } }), null);
});
