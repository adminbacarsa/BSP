/**
 * Agenda: misma jerarquía que Hoy, estado en el chip, sin acciones en lo ya trabajado.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/agendaShiftCard.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgendaShiftView } from './agendaShiftCard';
import type { ShiftPlacement } from './shiftPlacement';

const plaza: ShiftPlacement = {
  client: 'Plaza de la Musica',
  objective: 'Plaza de La Musica',
  position: 'puerta campus',
  line: 'Plaza de la Musica · Plaza de La Musica · puerta campus',
  objectiveLocation: null,
};

describe('buildAgendaShiftView', () => {
  it('evento ya trabajado: fecha, Evento · servicio, lugar una vez, nota, chip Trabajado, sin acciones', () => {
    const v = buildAgendaShiftView({
      cuando: 'Sáb 17/10 · 10:00–20:00',
      placement: plaza,
      ev: {
        nombre: 'pumas',
        eventoNombre: 'La Renga',
        horarioBadge: '10:00–20:00',
        direccion: 'Plaza de La Musica',
        mapsUrl: 'https://maps.example/renga',
        requisitos: null,
        instrucciones: null,
      },
      isWorked: true,
    });
    assert.equal(v.cuando, 'Sáb 17/10 · 10:00–20:00');
    assert.equal(v.whereTitle, 'Evento: La Renga · servicio pumas');
    assert.equal(v.wherePlace, 'Plaza de La Musica');
    assert.equal(v.note, 'puerta campus');
    assert.equal(v.estado, 'Trabajado');
    assert.equal(v.permiteAcciones, false);
    assert.equal((`${v.whereTitle} ${v.wherePlace} ${v.note}`.match(/Plaza de La Musica/gi) || []).length, 1);
    assert.doesNotMatch(`${v.whereTitle} ${v.note}`, /ya trabajado|Cómo llegar/);
  });

  it('próximo, ausente y franco van al chip; el próximo sí puede tener acciones', () => {
    const prox = buildAgendaShiftView({
      cuando: 'Mañana · 08:00–16:00',
      placement: { ...plaza, position: 'Puesto 1', client: 'Caminos', objective: 'Peaje' },
      isWorked: false,
    });
    assert.equal(prox.estado, 'Próximo');
    assert.equal(prox.whereTitle, 'Caminos · Peaje');
    assert.equal(prox.wherePlace, 'Puesto 1');
    assert.equal(prox.permiteAcciones, true);

    const aus = buildAgendaShiftView({ cuando: 'Hoy · 08:00–16:00', placement: plaza, isAbsent: true });
    assert.equal(aus.estado, 'Ausente');
    assert.equal(aus.permiteAcciones, false);

    const franco = buildAgendaShiftView({
      cuando: 'Sáb 17/10',
      placement: plaza,
      isFranco: true,
    });
    assert.equal(franco.estado, 'Franco');
    assert.equal(franco.whereTitle, 'Día de descanso programado');
  });
});
