import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  debeVencer, huecoKeyDe, pendientesACerrar, reservarLugar, revalidacionFalla, textoConsulta, textoEstadoConsulta, tomadosTrasNoElegible, venceEnMs,
} from './consultaDisponibilidad.mjs';

const base = { lugares: 2, tomados: 0, status: 'ABIERTA', venceAtMs: 5_000, ahoraMs: 1_000, estadoInvitacion: 'PENDIENTE' };

describe('consulta de disponibilidad', () => {
  it('el primero toma el lugar 1 y el segundo el 2; el tercero encuentra el cupo lleno', () => {
    const primero = reservarLugar(base);
    assert.deepEqual(primero, { ok: true, orden: 1, idempotente: false });
    const segundo = reservarLugar({ ...base, tomados: 1 });
    assert.equal(segundo.orden, 2);
    const tercero = reservarLugar({ ...base, tomados: 2 });
    assert.equal(tercero.ok, false);
    assert.equal(tercero.codigo, 'COMPLETA');
  });

  it('quien ya dijo que sí no ocupa otro lugar', () => {
    const otra = reservarLugar({ ...base, tomados: 1, estadoInvitacion: 'ASIGNADO' });
    assert.equal(otra.ok, true);
    assert.equal(otra.idempotente, true);
  });

  it('vencida o cerrada no asigna', () => {
    assert.equal(reservarLugar({ ...base, ahoraMs: 9_000 }).codigo, 'VENCIDA');
    assert.equal(reservarLugar({ ...base, status: 'VENCIDA' }).codigo, 'VENCIDA');
    assert.equal(reservarLugar({ ...base, status: 'COMPLETA' }).codigo, 'COMPLETA');
    assert.equal(reservarLugar({ ...base, estadoInvitacion: 'CUBIERTO' }).codigo, 'COMPLETA');
    assert.equal(debeVencer({ status: 'ABIERTA', ahoraMs: 9_000, venceAtMs: 5_000 }), true);
    assert.equal(debeVencer({ status: 'COMPLETA', ahoraMs: 9_000, venceAtMs: 5_000 }), false);
  });

  it('con el cupo lleno cierra a los pendientes y libera el lugar si la revalidación falla', () => {
    const invitaciones = [
      { id: 'a', estado: 'ASIGNADO' },
      { id: 'b', estado: 'ASIGNADO' },
      { id: 'c', estado: 'PENDIENTE' },
    ];
    assert.deepEqual(pendientesACerrar(invitaciones, 1, 2), []);
    assert.deepEqual(pendientesACerrar(invitaciones, 2, 2), ['c']);
    const respuestas = [
      { cuil: '1', estado: 'RESERVADO' },
      { cuil: '2', estado: 'ASIGNADO' },
    ];
    assert.equal(tomadosTrasNoElegible(respuestas, '1'), 1);
    const falla = revalidacionFalla('Supera el tope mensual');
    assert.equal(falla.lugarLibre, true);
    assert.equal(falla.codigo, 'NO_ELEGIBLE');
  });

  it('el plazo no pasa del inicio del primer turno y el texto nombra el hueco', () => {
    const ahora = Date.parse('2026-11-02T10:00:00.000-03:00');
    const inicio = Date.parse('2026-11-02T12:00:00.000-03:00');
    assert.equal(venceEnMs({ ahoraMs: ahora, minutos: 120, inicioPrimerTurnoMs: inicio }), inicio);
    assert.equal(venceEnMs({ ahoraMs: ahora, minutos: 30, inicioPrimerTurnoMs: inicio }), ahora + 30 * 60000);
    assert.equal(venceEnMs({ ahoraMs: ahora, minutos: 0, inicioPrimerTurnoMs: inicio }), inicio);
    const texto = textoConsulta({
      cliente: 'Norte', objetivo: 'Peaje', puesto: 'Puesto 1',
      jornadas: [{ fecha: '2026-11-02', code: 'M', horaInicio: '08:00', horaFin: '16:00' }],
    });
    assert.match(texto, /02\/11 M 08:00–16:00/);
    assert.match(texto, /Norte · Peaje · Puesto 1/);
    const linea = textoEstadoConsulta([
      { nombre: 'Pérez, Ana', estado: 'ASIGNADO', hora: '10:42' },
      { nombre: 'Gómez, Luis', estado: 'PENDIENTE' },
    ]);
    assert.equal(linea, '2 consultados · 1 sí (Pérez 10:42) · 1 pendiente');
    assert.ok(huecoKeyDe({ empresaId: 'e', objectiveId: 'o', positionName: 'P1', jornadas: [{ fecha: '2026-11-02', horaInicio: '08:00', horaFin: '16:00' }] }).startsWith('e|o|P1|'));
  });
});
