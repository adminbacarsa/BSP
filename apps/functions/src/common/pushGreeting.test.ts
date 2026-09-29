import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guardFirstName, guardLead } from './pushGreeting.ts';

describe('guardFirstName', () => {
  it('prioriza firstName y lo capitaliza', () => {
    assert.equal(guardFirstName({ firstName: 'ARIEL', employeeName: 'BOSIO, Carlos' }), 'Ariel');
  });

  it('toma el nombre después de la coma', () => {
    assert.equal(guardFirstName({ employeeName: 'FANTINI MALDONADO, Ariel' }), 'Ariel');
    assert.equal(guardFirstName({ employeeName: 'BOSIO, Ariel' }), 'Ariel');
  });

  it('sin nombre no inventa saludo', () => {
    assert.equal(guardFirstName({ firstName: 'undefined', employeeName: '' }), '');
    assert.equal(guardFirstName(null), '');
    assert.equal(guardLead('', 'tu turno arranca a las 11:30.'), 'tu turno arranca a las 11:30.');
  });
});
