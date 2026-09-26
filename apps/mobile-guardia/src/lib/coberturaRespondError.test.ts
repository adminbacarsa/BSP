import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCoberturaRespondError,
  isRetryablePortalError,
} from './coberturaRespondError.ts';

describe('classifyCoberturaRespondError', () => {
  it('failed-precondition ACCEPTED → Ya fue cubierta + stale', () => {
    const r = classifyCoberturaRespondError({
      code: 'functions/failed-precondition',
      message: 'La convocatoria ya fue ACCEPTED.',
    });
    assert.equal(r.kind, 'stale');
    assert.equal(r.message, 'Ya fue cubierta.');
  });

  it('failed-precondition EXPIRED → venció + stale', () => {
    const r = classifyCoberturaRespondError({
      code: 'failed-precondition',
      message: 'La convocatoria ya fue EXPIRED.',
    });
    assert.equal(r.kind, 'stale');
    assert.equal(r.message, 'La convocatoria venció.');
  });

  it('not-found → stale', () => {
    const r = classifyCoberturaRespondError({
      code: 'functions/not-found',
      message: 'Convocatoria no encontrada.',
    });
    assert.equal(r.kind, 'stale');
  });

  it('network → retryable y NO stale', () => {
    assert.equal(isRetryablePortalError({ code: 'unavailable', message: 'network' }), true);
    const r = classifyCoberturaRespondError({
      code: 'unavailable',
      message: 'Failed to fetch',
    });
    assert.equal(r.kind, 'retryable');
    assert.match(r.message, /Reintentá/i);
  });

  it('permission-denied genérico → retryable (no dismiss automático)', () => {
    const r = classifyCoberturaRespondError({
      code: 'permission-denied',
      message: 'No podés responder una convocatoria que no te pertenece.',
    });
    assert.equal(r.kind, 'retryable');
  });
});
