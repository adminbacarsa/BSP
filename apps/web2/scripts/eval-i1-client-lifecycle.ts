/**
 * Bloqueo de borrado físico de cliente y visibilidad operativa.
 * npx tsx scripts/eval-i1-client-lifecycle.ts
 */
import assert from 'node:assert/strict';
import {
  clientPhysicalDeleteBlockMessage,
  isClientInactive,
  isClientOperational,
} from '../src/lib/crm/clientLifecycle';
import { isFirestoreIndexError } from '../src/lib/crm/firestoreIndexError';

const none = { turnos: false, serviciosSla: false, ordenesCompra: false };

assert.equal(clientPhysicalDeleteBlockMessage('Banco', none), null);
assert.match(
  clientPhysicalDeleteBlockMessage('Banco de Córdoba', { ...none, turnos: true }) || '',
  /turnos/,
);
assert.match(
  clientPhysicalDeleteBlockMessage('CASISA', { turnos: true, serviciosSla: true, ordenesCompra: true }) || '',
  /turnos/,
);
assert.match(
  clientPhysicalDeleteBlockMessage('CASISA', { turnos: true, serviciosSla: true, ordenesCompra: true }) || '',
  /no se borran/,
);
assert.equal(isClientOperational('ACTIVE'), true);
assert.equal(isClientOperational(undefined), true);
assert.equal(isClientOperational('INACTIVE'), false);
assert.equal(isClientInactive('INACTIVO'), true);

const indexErr = Object.assign(new Error('The query requires an index'), { code: 'failed-precondition' });
assert.equal(isFirestoreIndexError(indexErr), true);
assert.equal(isFirestoreIndexError(new Error('permission-denied')), false);

console.log('eval-i1-client-lifecycle: ok');
