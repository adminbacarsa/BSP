import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertaCuentaSinLeer } from './alertaCardState';
import {
  MOTIVO_RETENCION_TERMINADA,
  notifRetencionEsHistorial,
  retencionTermino,
  textoTarjetaRetencion,
  textoVioRetencion,
  turnoMuestraTarjetaRetencion,
} from './retencionTarjeta';

const ar = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-03:00`).getTime();
const AHORA = ar('2026-10-07', '11:29');

describe('tarjeta de retención sale del turno', () => {
  it('el M de hoy sin empezar no se muestra, ni el turno de ayer ya cerrado', () => {
    const ayer = {
      id: 'HXY87OHLiSyAAv1m2YPL',
      isRetention: true,
      isPresent: true,
      isCompleted: true,
      status: 'COMPLETED',
      realEndTime: ar('2026-10-06', '15:15'),
      endTime: ar('2026-10-06', '15:15'),
      startTime: ar('2026-10-06', '11:30'),
    };
    const hoy = {
      id: 'hoy-m',
      code: 'M',
      isPresent: false,
      isRetention: false,
      isCompleted: false,
      startTime: ar('2026-10-07', '11:30'),
      endTime: ar('2026-10-07', '15:15'),
    };
    assert.equal(turnoMuestraTarjetaRetencion(ayer, AHORA), false);
    assert.equal(turnoMuestraTarjetaRetencion(hoy, AHORA), false);
  });

  it('retención activa sin fin real muestra a quién espera, desde cuándo y el tope 12:59', () => {
    const vivo = {
      id: 'ret',
      isRetention: true,
      isPresent: true,
      isCompleted: false,
      startTime: ar('2026-10-07', '11:30'),
      checkInAt: ar('2026-10-07', '11:30'),
      endTime: ar('2026-10-07', '15:15'),
      retentionStartedAt: ar('2026-10-07', '15:00'),
      lateReliefIncomingName: 'BRIZUELA',
      lateReliefEtaAt: ar('2026-10-07', '15:45'),
    };
    const now = ar('2026-10-07', '15:10');
    assert.equal(turnoMuestraTarjetaRetencion(vivo, now), true);
    const texto = textoTarjetaRetencion(vivo);
    assert.match(texto, /Quedás retenido/);
    assert.match(texto, /desde 15:00/);
    assert.match(texto, /Esperando a BRIZUELA \(llega 15:45\)/);
    assert.match(texto, /tope 00:29/);
    assert.equal(turnoMuestraTarjetaRetencion({ ...vivo, realEndTime: ar('2026-10-07', '15:20') }, now), false);
    assert.equal(retencionTermino(vivo, { ...vivo, realEndTime: ar('2026-10-07', '15:20'), isCompleted: true, isRetention: false }, now), true);
  });

  it('saliente presente vencido espera relevo aunque el servidor todavía no marcó isRetention', () => {
    const now = ar('2026-10-07', '15:20');
    const saliente = {
      id: 'sal',
      isPresent: true,
      isRetention: false,
      isCompleted: false,
      startTime: ar('2026-10-07', '07:00'),
      endTime: ar('2026-10-07', '15:15'),
    };
    assert.equal(turnoMuestraTarjetaRetencion(saliente, now), true);
    assert.match(textoTarjetaRetencion(saliente), /Esperá al relevo/);
    assert.match(textoTarjetaRetencion(saliente), /desde 15:15/);
  });
});

describe('bandeja de retención', () => {
  const vivo = { id: 'ret', isRetention: true, isPresent: true, endTime: ar('2026-10-07', '15:15') };
  const cerrado = { id: 'old', isCompleted: true, status: 'COMPLETED', realEndTime: ar('2026-10-06', '15:15') };

  it('la de un turno cerrado es historial y no suma sin leer', () => {
    const notif = { type: 'RETENCION_AVISO', turnoId: 'old', read: false };
    assert.equal(notifRetencionEsHistorial(notif, [vivo, cerrado], AHORA), true);
    assert.equal(
      alertaCuentaSinLeer({
        type: 'RETENCION_AVISO',
        read: false,
        closedMotivo: MOTIVO_RETENCION_TERMINADA,
        nowMs: AHORA,
      }),
      false,
    );
  });

  it('las viejas sin turno no cuentan si no hay retención viva', () => {
    const vieja = { type: 'RETENCION_AUTO', read: false };
    assert.equal(notifRetencionEsHistorial(vieja, [cerrado], AHORA), true);
    assert.equal(notifRetencionEsHistorial(vieja, [vivo], AHORA), false);
    assert.equal(notifRetencionEsHistorial(vieja, null, AHORA), false);
    assert.equal(notifRetencionEsHistorial({ type: 'RETENCION_AVISO', shiftId: 'ret' }, [vivo], AHORA), false);
  });

  it('el acuse se lee en hora argentina', () => {
    assert.equal(textoVioRetencion(ar('2026-10-07', '15:08')), 'vio la retención 15:08');
    assert.equal(textoVioRetencion(null), null);
  });
});
