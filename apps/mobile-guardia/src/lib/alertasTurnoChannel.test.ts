/**
 * Contrato del canal Android alertas_turno (sin cargar expo-notifications).
 * node --experimental-strip-types --test src/lib/alertasTurnoChannel.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERTAS_TURNO_CHANNEL,
  ALERTAS_TURNO_CHANNEL_ID,
  ALERTAS_TURNO_CHANNEL_ID_LEGACY,
  ALERTAS_TURNO_SOUND_IOS,
  binaryHasAlertasTurnoSound,
} from './alertasTurnoChannel.ts';

describe('alertas_turno_v2 — solo en binarios con el wav', () => {
  it('binario viejo (OTA sobre < 1.2.0 o sin versión) no crea v2', () => {
    for (const v of [null, undefined, '', '1.1.3', '1.0.0', '1.1.99']) {
      assert.equal(binaryHasAlertasTurnoSound(v), false, String(v));
    }
  });
  it('binario >= 1.2.0 crea v2', () => {
    for (const v of ['1.2.0', '1.2.5', '1.10.0', '2.0.0']) {
      assert.equal(binaryHasAlertasTurnoSound(v), true, v);
    }
  });
});

describe('alertas_turno', () => {
  it('id, importancia MAX, sonido, vibración y pantalla bloqueada', () => {
    assert.equal(ALERTAS_TURNO_CHANNEL_ID, 'alertas_turno_v2');
    assert.equal(ALERTAS_TURNO_CHANNEL.importance, 'MAX');
    assert.equal(ALERTAS_TURNO_CHANNEL.sound, 'alertas_turno');
    assert.equal(ALERTAS_TURNO_CHANNEL.lockscreenVisibility, 'PUBLIC');
    assert.equal(ALERTAS_TURNO_CHANNEL.enableVibrate, true);
    assert.equal(ALERTAS_TURNO_CHANNEL.audioUsage, 'ALARM');
    assert.equal(ALERTAS_TURNO_CHANNEL_ID_LEGACY, 'alertas_turno');
    assert.equal(ALERTAS_TURNO_SOUND_IOS, 'alertas_turno.wav');
    assert.ok(ALERTAS_TURNO_CHANNEL.vibrationPattern.some((n) => n >= 500));
  });
});
