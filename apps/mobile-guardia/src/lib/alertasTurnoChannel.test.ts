/**
 * Contrato del canal Android alertas_turno (sin cargar expo-notifications).
 * node --experimental-strip-types --test src/lib/alertasTurnoChannel.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTAS_TURNO_CHANNEL, ALERTAS_TURNO_CHANNEL_ID } from './alertasTurnoChannel.ts';

describe('alertas_turno', () => {
  it('id, importancia MAX, sonido, vibración y pantalla bloqueada', () => {
    assert.equal(ALERTAS_TURNO_CHANNEL_ID, 'alertas_turno');
    assert.equal(ALERTAS_TURNO_CHANNEL.importance, 'MAX');
    assert.equal(ALERTAS_TURNO_CHANNEL.sound, 'default');
    assert.equal(ALERTAS_TURNO_CHANNEL.lockscreenVisibility, 'PUBLIC');
    assert.equal(ALERTAS_TURNO_CHANNEL.enableVibrate, true);
    assert.equal(ALERTAS_TURNO_CHANNEL.audioUsage, 'ALARM');
    assert.ok(ALERTAS_TURNO_CHANNEL.vibrationPattern.some((n) => n >= 500));
  });
});
