/**
 * Tests — gate de notificaciones obligatorias (nativo).
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/pushPermissionGate.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_IMPORTANCE,
  decidePushActivateAction,
  isAlertasChannelBlocked,
  PUSH_REQUIRED_BUTTON,
  resolvePushEstado,
  shouldShowPushRequiredBanner,
  pushGateReason,
} from './pushPermissionGate';

describe('decidePushActivateAction', () => {
  it('undetermined → request (diálogo del sistema)', () => {
    assert.equal(
      decidePushActivateAction({ permission: { status: 'undetermined', canAskAgain: true } }),
      'request',
    );
  });

  it('denied con canAskAgain → request', () => {
    assert.equal(
      decidePushActivateAction({ permission: { status: 'denied', canAskAgain: true } }),
      'request',
    );
  });

  it('denied sin canAskAgain → open_settings', () => {
    assert.equal(
      decidePushActivateAction({ permission: { status: 'denied', canAskAgain: false } }),
      'open_settings',
    );
  });

  it('granted + canal bloqueado → open_settings', () => {
    assert.equal(
      decidePushActivateAction({
        permission: { status: 'granted', canAskAgain: false },
        channelBlocked: true,
      }),
      'open_settings',
    );
  });

  it('granted + canal OK → none', () => {
    assert.equal(
      decidePushActivateAction({
        permission: { status: 'granted', canAskAgain: false },
        channelBlocked: false,
      }),
      'none',
    );
  });
});

describe('isAlertasChannelBlocked', () => {
  it('NONE / MIN / LOW = bloqueado; HIGH/MAX = OK; missing no cuenta', () => {
    assert.equal(isAlertasChannelBlocked({ missing: false, importance: ANDROID_IMPORTANCE.NONE }), true);
    assert.equal(isAlertasChannelBlocked({ missing: false, importance: ANDROID_IMPORTANCE.MIN }), true);
    assert.equal(isAlertasChannelBlocked({ missing: false, importance: ANDROID_IMPORTANCE.LOW }), true);
    assert.equal(isAlertasChannelBlocked({ missing: false, importance: ANDROID_IMPORTANCE.DEFAULT }), false);
    assert.equal(isAlertasChannelBlocked({ missing: false, importance: ANDROID_IMPORTANCE.MAX }), false);
    assert.equal(isAlertasChannelBlocked({ missing: true, importance: null }), false);
    assert.equal(isAlertasChannelBlocked(null), false);
  });
});

describe('resolvePushEstado', () => {
  it('activo / denegado / sin_token', () => {
    assert.equal(resolvePushEstado({ permissionGranted: true, hasToken: true }), 'activo');
    assert.equal(resolvePushEstado({ permissionGranted: false, hasToken: false }), 'denegado');
    assert.equal(
      resolvePushEstado({ permissionGranted: true, hasToken: true, channelBlocked: true }),
      'denegado',
    );
    assert.equal(resolvePushEstado({ permissionGranted: true, hasToken: false }), 'sin_token');
  });
});

describe('shouldShowPushRequiredBanner', () => {
  it('solo nativo; web nunca; unsupported no insiste', () => {
    assert.equal(
      shouldShowPushRequiredBanner({ platform: 'android', permissionGranted: false }),
      true,
    );
    assert.equal(
      shouldShowPushRequiredBanner({ platform: 'ios', permissionGranted: false }),
      true,
    );
    assert.equal(
      shouldShowPushRequiredBanner({ platform: 'web', permissionGranted: false }),
      false,
    );
    assert.equal(
      shouldShowPushRequiredBanner({ platform: 'android', permissionGranted: true }),
      false,
    );
    assert.equal(
      shouldShowPushRequiredBanner({
        platform: 'android',
        permissionGranted: true,
        channelBlocked: true,
      }),
      true,
    );
    assert.equal(
      shouldShowPushRequiredBanner({
        platform: 'android',
        permissionGranted: false,
        unsupported: true,
      }),
      false,
    );
  });

  it('texto del botón fijo', () => {
    assert.equal(PUSH_REQUIRED_BUTTON, 'Activar ahora');
  });

  it('motivo permission vs channel', () => {
    assert.equal(pushGateReason({ permissionGranted: false }), 'permission');
    assert.equal(pushGateReason({ permissionGranted: true, channelBlocked: true }), 'channel');
    assert.equal(pushGateReason({ permissionGranted: true, channelBlocked: false }), null);
  });
});
