import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cierreDeConsulta, debeVencer, huecoKeyDe, invitacionHayQueCerrarla, mensajeRespuestaCerrada, MENSAJE_CUBIERTO, MENSAJE_VENCIDA, MENSAJE_YA_NO_HACE_FALTA,
  pendientesACerrar, reservarLugar, revalidacionFalla, textoConsulta, textoEstadoConsulta, tomadosTrasNoElegible, venceEnMs,
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
    assert.equal(reservarLugar({ ...base, estadoInvitacion: 'AVISO_MAIL' }).ok, true);
    assert.equal(reservarLugar({ ...base, estadoInvitacion: 'NO' }).codigo, 'YA_RESPONDIO');
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

  it('al cerrar la consulta, AVISO_MAIL, NO_LLEGO y RESERVADO pasan al estado final', () => {
    const cubierta = cierreDeConsulta('COMPLETA');
    assert.equal(cubierta?.estado, 'CUBIERTO');
    assert.equal(cubierta?.motivo, MENSAJE_CUBIERTO);
    assert.equal(cubierta?.avisar, true);
    assert.equal(cubierta?.tipoAviso, 'CONSULTA_CUBIERTA');
    const cancelada = cierreDeConsulta('CERRADA');
    assert.equal(cancelada?.estado, 'CANCELADA');
    assert.equal(cancelada?.motivo, MENSAJE_YA_NO_HACE_FALTA);
    assert.equal(cancelada?.avisar, true);
    assert.equal(cierreDeConsulta('SIN_DESTINATARIOS')?.avisar, false);
    assert.equal(cierreDeConsulta('SIN_DESTINATARIOS')?.estado, 'CANCELADA');
    const vencida = cierreDeConsulta('VENCIDA');
    assert.equal(vencida?.estado, 'VENCIDA');
    assert.equal(vencida?.motivo, MENSAJE_VENCIDA);
    assert.equal(vencida?.avisar, false);
    assert.equal(cierreDeConsulta('ABIERTA'), null);
    assert.equal(invitacionHayQueCerrarla('PENDIENTE'), true);
    assert.equal(invitacionHayQueCerrarla('AVISO_MAIL'), true);
    assert.equal(invitacionHayQueCerrarla('NO_LLEGO'), true);
    assert.equal(invitacionHayQueCerrarla('RESERVADO'), true);
    assert.equal(invitacionHayQueCerrarla('ASIGNADO'), false);
    assert.equal(invitacionHayQueCerrarla('NO'), false);
    assert.equal(invitacionHayQueCerrarla('CUBIERTO'), false);
    assert.equal(mensajeRespuestaCerrada('CUBIERTO', 'COMPLETA', 'COMPLETA'), MENSAJE_CUBIERTO);
    assert.equal(mensajeRespuestaCerrada('CANCELADA', 'CERRADA', 'YA_RESPONDIO'), MENSAJE_YA_NO_HACE_FALTA);
    assert.equal(mensajeRespuestaCerrada('VENCIDA', 'VENCIDA', 'YA_RESPONDIO'), MENSAJE_VENCIDA);
    assert.deepEqual(pendientesACerrar([
      { id: 'a', estado: 'ASIGNADO' },
      { id: 'b', estado: 'NO' },
      { id: 'c', estado: 'AVISO_MAIL' },
      { id: 'd', estado: 'NO_LLEGO' },
      { id: 'e', estado: 'RESERVADO' },
      { id: 'f', estado: 'CUBIERTO' },
    ], 1, 1), ['c', 'd', 'e']);
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
    assert.match(texto, /^¿Estás disponible /);
    const bloque = textoConsulta({
      cliente: null, objetivo: 'Peaje 9 Norte', puesto: 'Puesto 1',
      jornadas: [
        { fecha: '2026-10-06', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
        { fecha: '2026-10-15', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
      ],
    });
    assert.equal(bloque, '¿Podés cubrir 2 días (06/10 → 15/10) en Peaje 9 Norte · Puesto 1? 06/10 M 07:00–15:00, 15/10 M 07:00–15:00.');
    const cruza = textoConsulta({
      objetivo: 'Peaje', puesto: null,
      jornadas: [
        { fecha: '2026-10-28', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
        { fecha: '2026-11-03', code: 'T', horaInicio: '15:00', horaFin: '23:00' },
      ],
    });
    assert.match(cruza, /^¿Podés cubrir 2 días \(28\/10 → 03\/11\) en Peaje\?/);
    assert.match(cruza, /28\/10 M 07:00–15:00, 03\/11 T 15:00–23:00/);
    assert.match(cruza, /Son dos contratos \(octubre 2026 y noviembre 2026\)/);
    const linea = textoEstadoConsulta([
      { nombre: 'Pérez, Ana', estado: 'ASIGNADO', hora: '10:42' },
      { nombre: 'Gómez, Luis', estado: 'PENDIENTE' },
    ]);
    assert.equal(linea, '2 consultados · 1 sí (Pérez 10:42) · 1 pendiente');
    assert.ok(huecoKeyDe({ empresaId: 'e', objectiveId: 'o', positionName: 'P1', jornadas: [{ fecha: '2026-11-02', horaInicio: '08:00', horaFin: '16:00' }] }).startsWith('e|o|P1|'));
  });
});
