import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildObjectiveOwnerMap,
  correctTurnoClientId,
  OBJETIVO_SIN_CLIENTE,
  planTurnoClientPatch,
  resetObjectiveOwnerCache,
  type ClientsQueryDb,
  type TurnoClientPatch,
} from './turnoClientOwner';

function ownersOf(clients: Array<{ id: string; objetivos: string[] }>) {
  return buildObjectiveOwnerMap(clients.map((c) => ({
    id: c.id,
    data: () => ({ objetivos: c.objetivos.map((id) => ({ id })) }),
  })));
}

function fakeDb(clients: Array<{ id: string; objetivos: string[] }>): ClientsQueryDb {
  return {
    collection() {
      return {
        where() {
          return {
            async get() {
              return {
                docs: clients.map((c) => ({
                  id: c.id,
                  data: () => ({ objetivos: c.objetivos.map((id) => ({ id })) }),
                })),
              };
            },
          };
        },
      };
    },
  };
}

function apply(data: Record<string, unknown>, patch: TurnoClientPatch): Record<string, unknown> {
  const next = { ...data };
  if (patch.clientId) next.clientId = patch.clientId;
  if (patch.integrityIssue === null) delete next.integrityIssue;
  else if (patch.integrityIssue) next.integrityIssue = patch.integrityIssue;
  return next;
}

describe('planTurnoClientPatch', () => {
  const owners = ownersOf([{ id: 'cli-real', objetivos: ['obj-1'] }]);

  it('corrige un clientId que no es el dueño', () => {
    const patch = planTurnoClientPatch(
      { empresaId: 'bacarsa', objectiveId: 'obj-1', clientId: 'cli-borrado' },
      owners,
    );
    assert.deepEqual(patch, { clientId: 'cli-real' });
  });

  it('no escribe si el clientId ya es el dueño', () => {
    assert.equal(
      planTurnoClientPatch(
        { empresaId: 'bacarsa', objectiveId: 'obj-1', clientId: 'cli-real' },
        owners,
      ),
      null,
    );
  });

  it('objetivo sin cliente: marca y no inventa clientId', () => {
    const patch = planTurnoClientPatch(
      { empresaId: 'bacarsa', objectiveId: 'obj-huerfano', clientId: 'cli-x' },
      owners,
    );
    assert.deepEqual(patch, { integrityIssue: OBJETIVO_SIN_CLIENTE });
    assert.equal(patch && 'clientId' in patch, false);
  });

  it('no reescribe si el objetivo ya está marcado sin cliente', () => {
    assert.equal(
      planTurnoClientPatch(
        {
          empresaId: 'bacarsa',
          objectiveId: 'obj-huerfano',
          clientId: 'cli-x',
          integrityIssue: OBJETIVO_SIN_CLIENTE,
        },
        owners,
      ),
      null,
    );
  });

  it('dueño ambiguo: no elige cliente', () => {
    const ambiguous = ownersOf([
      { id: 'a', objetivos: ['obj-1'] },
      { id: 'b', objetivos: ['obj-1'] },
    ]);
    assert.equal(
      planTurnoClientPatch({ empresaId: 'e', objectiveId: 'obj-1', clientId: '' }, ambiguous),
      null,
    );
  });
});

describe('correctTurnoClientId', () => {
  it('una sola escritura: la segunda pasada no actualiza', async () => {
    resetObjectiveOwnerCache();
    const db = fakeDb([{ id: 'cli-real', objetivos: ['obj-1'] }]);
    let data: Record<string, unknown> = {
      empresaId: 'bacarsa',
      objectiveId: 'obj-1',
      clientId: 'cli-borrado',
    };
    const writes: TurnoClientPatch[] = [];
    const ref = {
      update: async (patch: Record<string, unknown>) => {
        writes.push(patch as TurnoClientPatch);
      },
    };
    const encode = (patch: TurnoClientPatch) => {
      const out: Record<string, unknown> = {};
      if (patch.clientId) out.clientId = patch.clientId;
      return out;
    };
    assert.equal(await correctTurnoClientId(db, ref, data, encode), 'updated');
    data = apply(data, { clientId: 'cli-real' });
    assert.equal(await correctTurnoClientId(db, ref, data, encode), 'noop');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].clientId, 'cli-real');
  });

  it('objetivo sin cliente no dispara una segunda escritura', async () => {
    resetObjectiveOwnerCache();
    const db = fakeDb([{ id: 'cli-real', objetivos: ['obj-1'] }]);
    let data: Record<string, unknown> = {
      empresaId: 'bacarsa',
      objectiveId: 'obj-nadie',
      clientId: 'cli-x',
    };
    let writes = 0;
    const ref = { update: async () => { writes += 1; } };
    const encode = (patch: TurnoClientPatch) => ({ integrityIssue: patch.integrityIssue });
    assert.equal(await correctTurnoClientId(db, ref, data, encode), 'updated');
    data = { ...data, integrityIssue: OBJETIVO_SIN_CLIENTE };
    assert.equal(await correctTurnoClientId(db, ref, data, encode), 'noop');
    assert.equal(writes, 1);
  });
});
