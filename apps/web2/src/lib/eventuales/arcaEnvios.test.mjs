import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOKEN_VIGENCIA_MS,
  alertaAltaArcaPendiente,
  isAltaArcaConfirmada,
  nuevoToken,
  planEnvioAlta,
  planEnvioBaja,
  transicionEnvio,
  validarToken,
  vistaPublicaEnvio,
} from './arcaEnvios.mjs';

const contrato = {
  fechaAlta: '2026-10-02',
  fechaBaja: '2026-10-04',
  jornadas: [
    { fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 },
    { fecha: '2026-10-04', horaInicio: '08:00', horaFin: '16:00', horas: 8 },
  ],
};

const base = {
  contrato,
  contratoId: 'ctr_1',
  empresaId: 'bacarsa',
  cuil: '20999999991',
  bruto: 16000,
  obraSocial: '123456',
  empresa: { arcaEventuales: { cctCodigo: '42205', categoriaProfesional: '000001' } },
};

describe('envíos ARCA', () => {
  it('el alta nace al confirmar el contrato y la baja recién al cerrarlo', () => {
    const alta = planEnvioAlta(base);
    assert.equal(alta.ok, true);
    assert.equal(alta.envio.tipo, 'AT');
    assert.equal(alta.envio.estado, 'PENDIENTE');
    assert.equal(alta.envio.txt.slice(2, 4), 'AT');
    assert.equal(alta.envio.enviable, true);

    assert.equal(planEnvioAlta({ ...base, contrato: { ...contrato, jornadas: [] } }).codigo, 'SIN_JORNADAS');

    const sinAlta = planEnvioBaja({ ...base, enviosDelContrato: [alta.envio] });
    assert.equal(sinAlta.codigo, 'ALTA_NO_CONFIRMADA');

    const confirmada = { ...alta.envio, estado: 'CONFIRMADO' };
    const baja = planEnvioBaja({ ...base, enviosDelContrato: [confirmada] });
    assert.equal(baja.ok, true);
    assert.equal(baja.envio.tipo, 'BT');
    assert.equal(baja.envio.txt.slice(2, 4), 'BT');
    assert.equal(baja.envio.txt.slice(45, 47), '30');
  });

  it('las transiciones exigen número de transacción y no reabren un confirmado', () => {
    const envio = planEnvioAlta(base).envio;
    const subiendo = transicionEnvio(envio, { estado: 'SUBIENDO', origen: 'ROBOT' });
    assert.equal(subiendo.ok, true);
    assert.equal(transicionEnvio({ ...envio, ...subiendo.patch }, { estado: 'CONFIRMADO' }).codigo, 'FALTA_NRO_TRANSACCION');

    const ok = transicionEnvio({ ...envio, ...subiendo.patch }, {
      estado: 'CONFIRMADO',
      origen: 'LINK',
      nroTransaccion: ' 12345 ',
    });
    assert.equal(ok.patch.nroTransaccion, '12345');
    assert.equal(ok.patch.token, null);
    assert.equal(ok.patch.intentos.length, 2);
    assert.equal(transicionEnvio({ ...envio, ...ok.patch }, { estado: 'SUBIENDO' }).codigo, 'TRANSICION_INVALIDA');
  });

  it('el link es de un solo uso, vence a las 48 h y no muestra datos personales', () => {
    const now = Date.parse('2026-10-01T10:00:00.000Z');
    const t = nuevoToken(now, () => 0.5);
    assert.equal(t.token.length, 32);
    const envio = { ...planEnvioAlta(base).envio, ...t, empresaNombre: 'BACAR S.A.' };

    assert.equal(validarToken(envio, t.token, now + 1000).ok, true);
    assert.equal(validarToken(envio, 'otro', now).codigo, 'TOKEN_INVALIDO');
    assert.equal(validarToken(envio, t.token, now + TOKEN_VIGENCIA_MS + 1).codigo, 'TOKEN_VENCIDO');
    assert.equal(validarToken({ ...envio, tokenUsadoAt: '2026-10-01' }, t.token, now).codigo, 'TOKEN_USADO');
    assert.equal(validarToken({ ...envio, estado: 'CONFIRMADO' }, t.token, now).codigo, 'YA_CONFIRMADO');

    const vista = vistaPublicaEnvio(envio);
    assert.equal(vista.cantidadRegistros, 1);
    assert.equal(vista.empresaNombre, 'BACAR S.A.');
    assert.equal('bolsaCuil' in vista, false);
    assert.equal('txt' in vista, false);
  });

  it('sin alta confirmada no ficha y el CC ve la alerta desde T−2 h', () => {
    const inicio = Date.parse('2026-10-02T11:00:00.000Z');
    const turno = { esEventual: true, eventualAltaArcaConfirmada: false, startTimeMs: inicio, eventualContratoId: 'ctr_1' };
    assert.equal(isAltaArcaConfirmada(turno), false);
    assert.equal(isAltaArcaConfirmada({ ...turno, eventualAltaArcaConfirmada: true }), true);
    assert.equal(isAltaArcaConfirmada({ esEventual: false }), true);

    assert.equal(alertaAltaArcaPendiente(turno, inicio - 3 * 60 * 60 * 1000), null);
    const alerta = alertaAltaArcaPendiente(turno, inicio - 90 * 60 * 1000);
    assert.equal(alerta.tipo, 'ALTA_ARCA_PENDIENTE');
    assert.equal(alerta.prioridad, 'ALTA');
    assert.equal(alerta.minutosAlInicio, 90);
    assert.equal(alertaAltaArcaPendiente({ ...turno, eventualAltaArcaConfirmada: true }, inicio), null);
  });
});
