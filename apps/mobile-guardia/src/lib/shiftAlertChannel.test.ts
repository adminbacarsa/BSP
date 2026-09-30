/**
 * El servidor elige el canal por dispositivo: v2 solo a binarios >= 1.2.0.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/shiftAlertChannel.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIFT_ALERT_CHANNEL_ID,
  SHIFT_ALERT_CHANNEL_ID_LEGACY,
  SHIFT_ALERT_SOUND,
  SHIFT_ALERT_SOUND_IOS,
  groupTokensByShiftAlertChannel,
  shiftAlertChannelForDevice,
  shiftAlertPlatformConfig,
} from '../../../../apps/functions/src/notifications/shiftAlertFcm';
import { buildDeviceTokenDoc } from './deviceTokenDoc.ts';

const TOKEN_OLD = 'token-binario-viejo-xxxx';
const TOKEN_NEW = 'token-binario-nuevo-xxxx';

describe('FCM alertas de turno — canal por dispositivo', () => {
  it('v2: sonido propio y time-sensitive en iOS', () => {
    const cfg = shiftAlertPlatformConfig(SHIFT_ALERT_CHANNEL_ID);
    assert.equal(cfg.android.notification?.channelId, 'alertas_turno_v2');
    assert.equal(cfg.android.notification?.sound, SHIFT_ALERT_SOUND);
    assert.equal(cfg.apns.payload?.aps.sound, SHIFT_ALERT_SOUND_IOS);
    assert.equal(cfg.apns.payload?.aps['interruption-level'], 'time-sensitive');
    assert.equal(cfg.android.priority, 'high');
  });

  it('legado: alertas_turno con sonido default (canal MAX que ya existe)', () => {
    const cfg = shiftAlertPlatformConfig(SHIFT_ALERT_CHANNEL_ID_LEGACY);
    assert.equal(cfg.android.notification?.channelId, 'alertas_turno');
    assert.equal(cfg.android.notification?.sound, 'default');
    assert.equal(cfg.apns.payload?.aps['interruption-level'], 'time-sensitive');
    assert.equal(shiftAlertPlatformConfig().android.notification?.channelId, 'alertas_turno');
  });

  it('token sin versión nativa (binario actual) → alertas_turno', () => {
    const doc = buildDeviceTokenDoc({ uid: 'u', employeeId: 'e', token: TOKEN_OLD, platform: 'android' });
    assert.equal(doc.nativeVersion, undefined);
    assert.equal(shiftAlertChannelForDevice(doc), 'alertas_turno');
    assert.equal(shiftAlertChannelForDevice(null), 'alertas_turno');
  });

  it('binarios < 1.2.0 → alertas_turno; >= 1.2.0 → alertas_turno_v2', () => {
    for (const v of ['1.1.3', '1.0.0', '0.9.9', 'basura']) {
      assert.equal(shiftAlertChannelForDevice({ nativeVersion: v }), 'alertas_turno', v);
    }
    for (const v of ['1.2.0', '1.2.1', '1.10.0', '2.0.0']) {
      assert.equal(shiftAlertChannelForDevice({ nativeVersion: v }), 'alertas_turno_v2', v);
    }
  });

  it('agrupa por canal: un multicast por grupo, sin duplicar tokens', () => {
    const newDoc = buildDeviceTokenDoc({
      uid: 'u',
      employeeId: 'e',
      token: TOKEN_NEW,
      platform: 'android',
      nativeVersion: '1.2.0',
    });
    assert.equal(newDoc.nativeVersion, '1.2.0');
    const groups = groupTokensByShiftAlertChannel([
      { token: TOKEN_OLD, data: { nativeVersion: '1.1.3' } },
      { token: TOKEN_NEW, data: newDoc },
      { token: TOKEN_NEW, data: newDoc },
    ]);
    assert.deepEqual(groups.get('alertas_turno'), [TOKEN_OLD]);
    assert.deepEqual(groups.get('alertas_turno_v2'), [TOKEN_NEW]);
    assert.equal(groups.size, 2);
  });
});
