/**
 * Tests unitarios — validación de dispositivo (sin Firebase / React).
 * Ejecutar: node --experimental-strip-types --test src/lib/deviceVerification.test.ts
 * (desde apps/mobile-guardia)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canRequestDeviceRegistration,
  DEVICE_BLOCK_MESSAGES,
  evaluateDeviceTokenBinding,
  extractPlatformDeviceErrorCode,
  mapPlatformDeviceErrorMessage,
} from './deviceVerification.ts';

describe('evaluateDeviceTokenBinding', () => {
  it('sin token → never_activated', () => {
    const r = evaluateDeviceTokenBinding({ tokenExists: false });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'never_activated');
  });

  it('token sin verified → never_activated', () => {
    const r = evaluateDeviceTokenBinding({
      tokenExists: true,
      verified: false,
      boundDeviceId: 'abc',
      localDeviceId: 'abc',
    });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'never_activated');
  });

  it('verified sin deviceId → needs_rebind (NO dejar pasar)', () => {
    const r = evaluateDeviceTokenBinding({
      tokenExists: true,
      verified: true,
      boundDeviceId: null,
      localDeviceId: 'local-1',
    });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'needs_rebind');
    assert.equal(
      DEVICE_BLOCK_MESSAGES.needs_rebind,
      'Validá este dispositivo con el mail de acceso o pedí aprobación a RRHH.',
    );
  });

  it('verified con deviceId vacío → needs_rebind', () => {
    const r = evaluateDeviceTokenBinding({
      tokenExists: true,
      verified: true,
      boundDeviceId: '   ',
      localDeviceId: 'local-1',
    });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'needs_rebind');
  });

  it('deviceId distinto → other_device', () => {
    const r = evaluateDeviceTokenBinding({
      tokenExists: true,
      verified: true,
      boundDeviceId: 'bound-A',
      localDeviceId: 'local-B',
    });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'other_device');
  });

  it('sin localDeviceId → other_device', () => {
    const r = evaluateDeviceTokenBinding({
      tokenExists: true,
      verified: true,
      boundDeviceId: 'bound-A',
      localDeviceId: null,
    });
    assert.equal(r.verified, false);
    assert.equal(r.reason, 'other_device');
  });

  it('mismo deviceId → verified', () => {
    const r = evaluateDeviceTokenBinding({
      tokenExists: true,
      verified: true,
      boundDeviceId: 'same-id',
      localDeviceId: 'same-id',
    });
    assert.equal(r.verified, true);
    assert.equal(r.reason, undefined);
  });
});

describe('códigos Plataforma', () => {
  it('extrae DEVICE_OWNED_BY_OTHER del message', () => {
    assert.equal(
      extractPlatformDeviceErrorCode({ message: 'DEVICE_OWNED_BY_OTHER' }),
      'DEVICE_OWNED_BY_OTHER',
    );
  });

  it('extrae RETIRED_DEVICE_NEEDS_EMAIL de details.code', () => {
    assert.equal(
      extractPlatformDeviceErrorCode({
        code: 'functions/failed-precondition',
        message: 'failed',
        details: { code: 'RETIRED_DEVICE_NEEDS_EMAIL' },
      }),
      'RETIRED_DEVICE_NEEDS_EMAIL',
    );
  });

  it('mensaje UX DEVICE_OWNED_BY_OTHER', () => {
    assert.equal(
      mapPlatformDeviceErrorMessage({ message: 'DEVICE_OWNED_BY_OTHER' }),
      'Este teléfono ya tiene otra cuenta validada. Cada teléfono se usa con un solo colaborador: entrá con esa cuenta, o pedile a RRHH que desvincule el teléfono.',
    );
  });

  it('mensaje UX RETIRED_DEVICE_NEEDS_EMAIL', () => {
    assert.equal(
      mapPlatformDeviceErrorMessage({ details: { code: 'RETIRED_DEVICE_NEEDS_EMAIL' } }),
      'Para volver a este dispositivo usá el mail de acceso.',
    );
  });

  it('RETIRED_DEVICE_NEEDS_EMAIL no ofrece registrar', () => {
    assert.equal(canRequestDeviceRegistration('RETIRED_DEVICE_NEEDS_EMAIL'), false);
  });

  it('DEVICE_OWNED_BY_OTHER no ofrece registrar', () => {
    assert.equal(canRequestDeviceRegistration('DEVICE_OWNED_BY_OTHER'), false);
  });

  it('other_device y needs_rebind sí ofrecen registrar / pedir RRHH', () => {
    assert.equal(canRequestDeviceRegistration('other_device'), true);
    assert.equal(canRequestDeviceRegistration('needs_rebind'), true);
  });

  it('never_activated no ofrece registrar', () => {
    assert.equal(canRequestDeviceRegistration('never_activated'), false);
  });
});
