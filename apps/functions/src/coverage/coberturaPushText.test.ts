/**
 * node --experimental-strip-types --test src/coverage/coberturaPushText.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coberturaBody, formatHoraAr24 } from './coberturaPushText.ts';

describe('formatHoraAr24', () => {
  it('siempre 24 h (nunca «05:00 p. m.»)', () => {
    assert.equal(formatHoraAr24(new Date('2026-10-05T17:00:00-03:00')), '17:00');
    assert.equal(formatHoraAr24(new Date('2026-10-05T00:30:00-03:00')), '00:30');
    assert.equal(formatHoraAr24(new Date('2026-10-05T12:00:00-03:00')), '12:00');
  });
});

describe('coberturaBody', () => {
  it('rango 24 h y lugar «Puesto en Objetivo»', () => {
    const body = coberturaBody({
      name: 'Laura',
      clientName: 'Caminos de las Sierras',
      objectiveName: 'Peaje 9 Norte',
      positionName: 'Puesto 1',
      horaInicio: formatHoraAr24(new Date('2026-10-05T16:00:00-03:00')),
      horaFin: formatHoraAr24(new Date('2026-10-05T17:00:00-03:00')),
    });
    assert.equal(body, 'Laura, ¿nos das una mano? Necesitamos cubrir Puesto 1 en Peaje 9 Norte de 16:00 a 17:00.');
    assert.doesNotMatch(body, /p\. m\./);
  });

  it('sin nombre arranca con mayúscula; sin fin dice «a las»; sin lugar dice «el puesto»', () => {
    assert.equal(
      coberturaBody({ positionName: 'Puesto 1', horaInicio: '16:00' }),
      '¿Nos das una mano? Necesitamos cubrir Puesto 1 a las 16:00.',
    );
    assert.equal(
      coberturaBody({ name: 'Ariel', horaInicio: '--:--' }),
      'Ariel, ¿nos das una mano? Necesitamos cubrir el puesto.',
    );
  });
});
