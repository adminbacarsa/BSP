import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessMode,
  pickDefaultMode,
  resolveVisibleModes,
  type StaffProfile,
} from '../../../../packages/ops-core/src/staffAppModes.ts';

function profile(partial: Partial<StaffProfile>): StaffProfile {
  return {
    isGuard: false,
    employeeId: null,
    isStaff: false,
    isSuperAdmin: false,
    empresas: [],
    modules: {},
    ...partial,
  };
}

describe('resolveVisibleModes — selección por permisos', () => {
  it('solo guardia si isGuard sin staff', () => {
    const modes = resolveVisibleModes(profile({ isGuard: true }));
    assert.deepEqual(
      modes.map((m) => m.id),
      ['guardia'],
    );
  });

  it('staff con OPERATIONS read ve Operación (sin Guardia)', () => {
    const modes = resolveVisibleModes(
      profile({
        isStaff: true,
        modules: { OPERATIONS: ['read', 'update'] },
      }),
    );
    assert.deepEqual(
      modes.map((m) => m.id),
      ['operacion'],
    );
  });

  it('guardia + RRHH read ve Guardia y RRHH', () => {
    const modes = resolveVisibleModes(
      profile({
        isGuard: true,
        isStaff: true,
        modules: { RRHH: ['read'] },
      }),
    );
    assert.deepEqual(
      modes.map((m) => m.id),
      ['guardia', 'rrhh'],
    );
  });

  it('sin read en PLANNING no muestra Planificación', () => {
    const modes = resolveVisibleModes(
      profile({
        isStaff: true,
        modules: { PLANNING: ['create'], OPERATIONS: ['read'] },
      }),
    );
    assert.ok(!modes.some((m) => m.id === 'planificacion'));
    assert.ok(modes.some((m) => m.id === 'operacion'));
  });

  it('SuperAdmin ve todos los modos Fase 0 incluido Guardia', () => {
    const modes = resolveVisibleModes(profile({ isSuperAdmin: true }));
    assert.deepEqual(
      modes.map((m) => m.id),
      ['guardia', 'operacion', 'supervision', 'rrhh', 'planificacion'],
    );
  });

  it('canAccessMode respeta permisos', () => {
    const p = profile({ isStaff: true, modules: { SUPERVISION: ['read'] } });
    assert.equal(canAccessMode(p, 'supervision'), true);
    assert.equal(canAccessMode(p, 'operacion'), false);
    assert.equal(canAccessMode(p, 'guardia'), false);
  });

  it('pickDefaultMode prefiere preferred si es visible', () => {
    const p = profile({
      isGuard: true,
      isStaff: true,
      modules: { OPERATIONS: ['read'], RRHH: ['read'] },
    });
    assert.equal(pickDefaultMode(p, 'rrhh'), 'rrhh');
    assert.equal(pickDefaultMode(p, null), 'guardia');
  });

  it('pickDefaultMode staff-only cae al primer modo staff', () => {
    const p = profile({
      isStaff: true,
      modules: { PLANNING: ['read'], OPERATIONS: ['read'] },
    });
    assert.equal(pickDefaultMode(p, null), 'operacion');
  });

  it('pickDefaultMode SuperAdmin sin preferred elige primer staff (no Guardia)', () => {
    const p = profile({ isSuperAdmin: true });
    assert.equal(pickDefaultMode(p, null), 'operacion');
  });
});
