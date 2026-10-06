/**
 * Preview SuperAdmin de un eventual: la bolsa y las callables no se abren a otros roles.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/eventualPreviewAuth.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canRespondCoberturaAsPreview,
  isEventualPreviewSuperAdmin,
  puedeResponderConsulta,
  resolveBolsaCuilForListar,
  resolvePreviewCheckIn,
} from '../../../../apps/functions/src/eventuales/eventualPreviewAuth';
import { esLegajoDeBolsa } from './previewEventual';

describe('listarTurnosEventual en preview', () => {
  it('el eventual ve solo su bolsa aunque pida otro CUIL', () => {
    const r = resolveBolsaCuilForListar({
      isSuperAdmin: false,
      ownBolsaCuil: '20111111111',
      requestedBolsaCuil: '20999999999',
    });
    assert.deepEqual(r, { bolsaCuil: '20111111111', preview: false });
  });

  it('SuperAdmin sin bolsa propia puede pedir un CUIL', () => {
    const r = resolveBolsaCuilForListar({
      isSuperAdmin: true,
      ownBolsaCuil: null,
      requestedBolsaCuil: ' 20333333333 ',
    });
    assert.deepEqual(r, { bolsaCuil: '20333333333', preview: true });
    assert.equal(isEventualPreviewSuperAdmin('SUPERADMIN'), true);
    assert.equal(isEventualPreviewSuperAdmin('SP'), true);
    assert.equal(isEventualPreviewSuperAdmin('ADMIN'), false);
    assert.equal(isEventualPreviewSuperAdmin('EVENTUAL', 'eventual'), false);
  });

  it('admin, operador y eventual sin bolsa no entran con bolsaCuil', () => {
    assert.equal(
      resolveBolsaCuilForListar({ isSuperAdmin: false, ownBolsaCuil: null, requestedBolsaCuil: '201' }),
      null,
    );
    assert.equal(
      resolveBolsaCuilForListar({ isSuperAdmin: true, ownBolsaCuil: null, requestedBolsaCuil: '' }),
      null,
    );
  });
});

describe('responder cobertura y fichada como el eventual', () => {
  it('solo SuperAdmin y solo si asEmployeeId es el candidato', () => {
    assert.equal(
      canRespondCoberturaAsPreview({ isSuperAdmin: true, asEmployeeId: 'leg_a', candidateEmployeeId: 'leg_a' }),
      true,
    );
    assert.equal(
      canRespondCoberturaAsPreview({ isSuperAdmin: true, asEmployeeId: 'leg_a', candidateEmployeeId: 'leg_b' }),
      false,
    );
    assert.equal(
      canRespondCoberturaAsPreview({ isSuperAdmin: false, asEmployeeId: 'leg_a', candidateEmployeeId: 'leg_a' }),
      false,
    );
    assert.equal(
      canRespondCoberturaAsPreview({ isSuperAdmin: true, asEmployeeId: '', candidateEmployeeId: 'leg_a' }),
      false,
    );
  });

  it('la fichada de preview queda acotada al legajo; sin asEmployeeId sigue el camino actual', () => {
    assert.deepEqual(
      resolvePreviewCheckIn({ isSuperAdmin: true, asEmployeeId: 'leg_a', shiftEmployeeId: 'leg_a' }),
      { scoped: true, empId: 'leg_a' },
    );
    assert.deepEqual(
      resolvePreviewCheckIn({ isSuperAdmin: true, asEmployeeId: 'leg_a', shiftEmployeeId: 'otro' }),
      { deny: true },
    );
    assert.deepEqual(
      resolvePreviewCheckIn({ isSuperAdmin: true, asEmployeeId: null, shiftEmployeeId: 'otro' }),
      { scoped: false },
    );
    assert.deepEqual(
      resolvePreviewCheckIn({ isSuperAdmin: false, asEmployeeId: 'leg_a', shiftEmployeeId: 'leg_a' }),
      { scoped: false },
    );
  });
});

describe('responder consulta en preview', () => {
  const base = {
    isSuperAdmin: false,
    authUid: 'uid-sa',
    claimBolsaCuil: null as string | null,
    ownEmployeeIds: [] as string[],
    asEmployeeId: null as string | null,
    asBolsaCuil: null as string | null,
    invUid: null as string | null,
    invBolsaCuil: '20334141463',
    invEmployeeId: null as string | null,
  };

  it('el eventual entra por claim aunque la invitación no tenga uid', () => {
    const r = puedeResponderConsulta({
      ...base,
      authUid: 'uid-ev',
      claimBolsaCuil: '20-33414146-3',
    });
    assert.deepEqual(r, { ok: true, preview: false });
  });

  it('SuperAdmin en preview responde en nombre del CUIL y queda marcado preview', () => {
    const r = puedeResponderConsulta({
      ...base,
      isSuperAdmin: true,
      asBolsaCuil: '20334141463',
    });
    assert.deepEqual(r, { ok: true, preview: true });
  });

  it('otro rol no responde una consulta ajena aunque mande el CUIL', () => {
    const r = puedeResponderConsulta({ ...base, asBolsaCuil: '20334141463' });
    assert.deepEqual(r, { ok: false });
  });

  it('el guardia entra por su legajo', () => {
    const r = puedeResponderConsulta({
      ...base,
      authUid: 'uid-g',
      ownEmployeeIds: ['emp-1'],
      invBolsaCuil: null,
      invEmployeeId: 'emp-1',
    });
    assert.deepEqual(r, { ok: true, preview: false });
  });
});

describe('solapa Legajos / Eventuales', () => {
  it('un legajo de la bolsa no aparece entre los vigiladores de planta', () => {
    assert.equal(esLegajoDeBolsa({ bolsaCuil: '201' }), true);
    assert.equal(esLegajoDeBolsa({ modalidad: 'EVENTUAL' }), true);
    assert.equal(esLegajoDeBolsa({ modalidad: 'PLANTA' }), false);
    assert.equal(esLegajoDeBolsa({}), false);
  });
});
