/**
 * Tests — mensaje de confirmación al aceptar/rechazar cobertura.
 * node --experimental-strip-types --test src/lib/coberturaRespondFeedback.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoberturaRespondFeedback } from './coberturaRespondFeedback.ts';

describe('buildCoberturaRespondFeedback', () => {
  it('REJECTED → título y mensaje cortos', () => {
    const r = buildCoberturaRespondFeedback('REJECTED');
    assert.equal(r.title, 'Convocatoria rechazada');
    assert.match(r.message, /No vas a cubrir/i);
  });

  it('ACCEPTED incluye objetivo, puesto y horario', () => {
    const r = buildCoberturaRespondFeedback('ACCEPTED', {
      clientName: 'Cliente SA',
      objectiveName: 'Objetivo Norte',
      positionName: 'Acceso',
      shiftCode: 'FT',
      startTime: '2026-09-26T15:00:00-03:00',
      endTime: '2026-09-26T23:00:00-03:00',
    });
    assert.equal(r.title, 'Convocatoria aceptada');
    assert.match(r.message, /Cliente SA · Objetivo Norte · Acceso/);
    assert.match(r.message, /FT/);
    assert.match(r.message, /Hoy/);
  });

  it('ACCEPTED sin detalle igual confirma', () => {
    const r = buildCoberturaRespondFeedback('ACCEPTED');
    assert.equal(r.title, 'Convocatoria aceptada');
    assert.match(r.message, /aceptada/i);
  });
});
