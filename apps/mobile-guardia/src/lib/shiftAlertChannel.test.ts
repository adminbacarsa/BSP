/**
 * El servidor pide el canal v2 (sonido propio). El id viejo queda solo como legado.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/shiftAlertChannel.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIFT_ALERT_CHANNEL_ID,
  SHIFT_ALERT_CHANNEL_ID_LEGACY,
  SHIFT_ALERT_SOUND,
  SHIFT_ALERT_SOUND_IOS,
  shiftAlertPlatformConfig,
} from '../../../../apps/functions/src/notifications/shiftAlertFcm';

describe('FCM alertas de turno', () => {
  it('manda alertas_turno_v2, sonido propio y time-sensitive en iOS', () => {
    const cfg = shiftAlertPlatformConfig();
    assert.equal(SHIFT_ALERT_CHANNEL_ID, 'alertas_turno_v2');
    assert.equal(SHIFT_ALERT_CHANNEL_ID_LEGACY, 'alertas_turno');
    assert.equal(cfg.android.notification?.channelId, 'alertas_turno_v2');
    assert.equal(cfg.android.notification?.sound, SHIFT_ALERT_SOUND);
    assert.equal(SHIFT_ALERT_SOUND, 'alertas_turno');
    assert.equal(cfg.apns.payload?.aps.sound, SHIFT_ALERT_SOUND_IOS);
    assert.equal(cfg.apns.payload?.aps['interruption-level'], 'time-sensitive');
    assert.equal(cfg.android.priority, 'high');
  });
});
