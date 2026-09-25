/**
 * Tests — payload device_tokens/{token} para preview SuperAdmin.
 * node --experimental-strip-types --test src/lib/pushNotifications.preview.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceTokenDoc } from './deviceTokenDoc.ts';

describe('buildDeviceTokenDoc — preview SuperAdmin', () => {
  it('incluye previewOf: true y employeeId del legajo', () => {
    const doc = buildDeviceTokenDoc({
      uid: 'sa-uid-1',
      employeeId: 'emp-pruebas-sa',
      empresaId: 'empresa-pruebas',
      token: 'fcm-token-abc',
      platform: 'web',
      previewOf: true,
    });
    assert.equal(doc.uid, 'sa-uid-1');
    assert.equal(doc.employeeId, 'emp-pruebas-sa');
    assert.equal(doc.previewOf, true);
    assert.equal(doc.token, 'fcm-token-abc');
    assert.equal(doc.platform, 'web');
    assert.equal(doc.empresaId, 'empresa-pruebas');
  });

  it('sin previewOf no escribe el campo (empleado normal)', () => {
    const doc = buildDeviceTokenDoc({
      uid: 'guard-uid',
      employeeId: 'emp-1',
      token: 'tok',
      platform: 'android',
    });
    assert.equal(doc.previewOf, undefined);
    assert.ok(!('previewOf' in doc));
    assert.equal(doc.uid, 'guard-uid');
    assert.equal(doc.employeeId, 'emp-1');
  });

  it('previewOf: false no marca el campo', () => {
    const doc = buildDeviceTokenDoc({
      uid: 'sa',
      employeeId: 'e1',
      token: 't',
      platform: 'ios',
      previewOf: false,
    });
    assert.ok(!('previewOf' in doc));
  });

  it('audience staff → role staff y pushAudience staff', () => {
    const doc = buildDeviceTokenDoc({
      uid: 'staff-uid',
      employeeId: null,
      empresaId: 'emp-1',
      token: 'tok-staff',
      platform: 'android',
      audience: 'staff',
    });
    assert.equal(doc.role, 'staff');
    assert.equal(doc.pushAudience, 'staff');
    assert.equal(doc.employeeId, null);
  });

  it('audience guard (default) → role employee', () => {
    const doc = buildDeviceTokenDoc({
      uid: 'g',
      employeeId: 'e1',
      token: 't',
      platform: 'web',
    });
    assert.equal(doc.role, 'employee');
    assert.equal(doc.pushAudience, 'guard');
  });
});
