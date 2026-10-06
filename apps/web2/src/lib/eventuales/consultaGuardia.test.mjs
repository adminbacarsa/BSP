import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  camposTurnoGuardia, evaluarGuardiaConsulta, horasMesSinDias, lugarDeGuardia, planEnvioGuardias, textoPushGuardia, tipoDeTurnoPropio,
} from './consultaGuardia.mjs';

const dia = { fecha: '2026-11-10', code: 'M', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
const franco = { fecha: '2026-11-10', code: 'F', isFranco: true, horaInicio: '00:00', horaFin: '23:59', horas: 0 };

describe('consulta de guardias propios', () => {
  it('el franco del día es FT; el retén y el día vacío son cobertura normal', () => {
    assert.equal(tipoDeTurnoPropio({ code: 'F', isFranco: true }), 'FT');
    assert.equal(tipoDeTurnoPropio({ code: 'FF' }), 'FT');
    assert.equal(tipoDeTurnoPropio({ code: 'RET' }), 'RET');
    assert.equal(tipoDeTurnoPropio(null), 'LIBRE');
    assert.equal(tipoDeTurnoPropio({ code: 'V' }), 'LICENCIA');
    assert.equal(tipoDeTurnoPropio({ code: 'M' }), null);
    assert.equal(tipoDeTurnoPropio({ code: 'FT', isFrancoTrabajado: true }), null);
  });

  it('el push del franco nombra los días y el franco trabajado', () => {
    assert.equal(textoPushGuardia({ dias: 2, tipo: 'FT', lugar: 'Norte · Peaje · Puesto 1' }), '¿Podés cubrir 2 días en Norte · Peaje · Puesto 1 como franco trabajado?');
    assert.equal(textoPushGuardia({ dias: 1, tipo: 'RET', lugar: 'Peaje' }), '¿Podés cubrir 1 día en Peaje?');
  });

  it('revalida: la licencia y el descanso menor a 8 h bloquean; 8–12 h y el tope piden PIN', () => {
    const licencia = evaluarGuardiaConsulta({
      tipo: 'FT', dias: [dia], turnos: [{ ...franco, code: 'V', isFranco: false }],
    });
    assert.equal(licencia.ok, false);
    assert.equal(licencia.codigo, 'BLOQUEADO');
    assert.match(licencia.motivo, /Licencia V/);

    const corto = evaluarGuardiaConsulta({
      tipo: 'LIBRE', dias: [dia],
      turnos: [{ fecha: '2026-11-09', code: 'T', horaInicio: '16:00', horaFin: '02:00', horas: 8 }],
    });
    assert.equal(corto.codigo, 'BLOQUEADO');
    assert.match(corto.motivo, /mínimo 8/);

    const medio = evaluarGuardiaConsulta({
      tipo: 'LIBRE', dias: [{ ...dia, horaInicio: '09:00', horaFin: '17:00' }],
      turnos: [{ fecha: '2026-11-09', code: 'T', horaInicio: '15:00', horaFin: '23:00', horas: 8 }],
    });
    assert.equal(medio.codigo, 'PIN_DESCANSO');
    const medioOk = evaluarGuardiaConsulta({
      tipo: 'LIBRE', dias: [{ ...dia, horaInicio: '09:00', horaFin: '17:00' }],
      turnos: [{ fecha: '2026-11-09', code: 'T', horaInicio: '15:00', horaFin: '23:00', horas: 8 }],
      autorizaciones: [{ kind: 'DESCANSO', motivo: 'viene de otro objetivo' }],
    });
    assert.equal(medioOk.ok, true);
    assert.equal(medioOk.marcas.descansoReducido, true);

    const tope = evaluarGuardiaConsulta({
      tipo: 'FT', dias: [dia], turnos: [franco, { fecha: '2026-11-02', code: 'M', horaInicio: '08:00', horaFin: '16:00', horas: 198 }],
    });
    assert.equal(tope.codigo, 'PIN_TOPE');
    const topeMes = evaluarGuardiaConsulta({
      tipo: 'FT', dias: [dia], turnos: [franco, { fecha: '2026-11-02', code: 'M', horaInicio: '08:00', horaFin: '16:00', horas: 198 }],
      topeMes: { '2026-11': true },
    });
    assert.equal(topeMes.ok, true);
    assert.equal(topeMes.marcas.topeExcedido, true);
  });

  it('el franco no mira el descanso (igual que la grilla) y el que ya no está de franco no entra', () => {
    const ft = evaluarGuardiaConsulta({
      tipo: 'FT', dias: [dia], turnos: [franco, { fecha: '2026-11-09', code: 'N', horaInicio: '23:00', horaFin: '07:00', horas: 8 }],
    });
    assert.equal(ft.ok, true);
    const yaNo = evaluarGuardiaConsulta({
      tipo: 'FT', dias: [dia], turnos: [{ fecha: '2026-11-10', code: 'M', horaInicio: '08:00', horaFin: '16:00', horas: 8 }],
    });
    assert.match(yaNo.motivo, /franco/);
  });

  it('el PIN se pide al enviar: quien no se autoriza no se consulta', () => {
    const candidatos = [
      { employeeId: 'a', tipo: 'FT', nombre: 'A' },
      { employeeId: 'b', tipo: 'FT', nombre: 'B' },
      { employeeId: 'c', tipo: 'LIBRE', nombre: 'C' },
      { employeeId: 'd', tipo: 'RET', nombre: 'D' },
    ];
    const evaluaciones = [
      { employeeId: 'a', blocked: [], authorizations: [{ kind: 'DESCANSO' }] },
      { employeeId: 'b', blocked: ['Licencia V ese día.'], authorizations: [] },
      { employeeId: 'c', blocked: [], authorizations: [{ kind: 'TOPE' }] },
      { employeeId: 'd', blocked: [], authorizations: [] },
    ];
    const sinPin = planEnvioGuardias({ candidatos, evaluaciones, puedeFt: true });
    assert.deepEqual(sinPin.consultables.map((c) => c.employeeId), ['d']);
    assert.equal(sinPin.omitidos.length, 3);

    const conPin = planEnvioGuardias({
      candidatos, evaluaciones, puedeFt: true,
      autorizados: { a: { descanso: true } },
      topeMes: { c: true },
    });
    assert.deepEqual(conPin.consultables.map((c) => c.employeeId), ['a', 'c', 'd']);
    assert.deepEqual(conPin.omitidos.map((o) => o.employeeId), ['b']);

    const sinFt = planEnvioGuardias({ candidatos: [candidatos[3], candidatos[0]], evaluaciones, puedeFt: false });
    assert.deepEqual(sinFt.consultables.map((c) => c.employeeId), ['d']);
    assert.match(sinFt.omitidos[0].motivo, /franco trabajado/);
  });

  it('el primero que acepta cubre; el siguiente encuentra el cupo lleno', () => {
    const base = { lugares: 1, tomados: 0, status: 'ABIERTA', venceAtMs: 5_000, ahoraMs: 1_000, estadoInvitacion: 'PENDIENTE' };
    const uno = lugarDeGuardia(base);
    assert.equal(uno.ok, true);
    assert.equal(uno.orden, 1);
    const otro = lugarDeGuardia({ ...base, tomados: 1 });
    assert.equal(otro.ok, false);
    assert.equal(otro.codigo, 'COMPLETA');
  });

  it('el turno FT lleva isFrancoTrabajado y no es un contrato', () => {
    const ft = camposTurnoGuardia({ tipo: 'FT', code: 'M', nombreCubierto: 'Sosa' });
    assert.equal(ft.isFrancoTrabajado, true);
    assert.equal(ft.isFranco, false);
    assert.equal(ft.code, 'M');
    assert.match(ft.comments, /Franco trabajado/);
    const ret = camposTurnoGuardia({ tipo: 'RET', code: 'T' });
    assert.equal(ret.isFrancoTrabajado, false);
    assert.match(ret.comments, /retén/);
    assert.equal(horasMesSinDias([
      { fecha: '2026-11-02', code: 'M', horas: 8 },
      { fecha: '2026-11-10', code: 'F', isFranco: true, horas: 0 },
    ], '2026-11', ['2026-11-10']), 8);
  });
});
