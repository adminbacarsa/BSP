/**
 * Avisos manuales del CC: texto, tipo y canal FCM.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/avisosCc.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { avisoEntranteTexto, isAvisoEntrante, isRetencionAviso } from './avisosCc.ts';
import { isShiftAlertFcmType } from '../../../../apps/functions/src/notifications/shiftAlertFcm.ts';

describe('avisos CC', () => {
  it('ENTRANTE muestra el body del server y, si falta, el texto del puesto', () => {
    assert.equal(
      avisoEntranteTexto({
        body: 'Mauro, te esperan en Peaje · Puesto 1, ¿venís? Contanos si llegás en 10, 15 o 30 min.',
      }),
      'Mauro, te esperan en Peaje · Puesto 1, ¿venís? Contanos si llegás en 10, 15 o 30 min.',
    );
    assert.equal(
      avisoEntranteTexto({ objectiveName: 'Peaje', positionName: 'Puesto 1' }),
      'Te esperan en Peaje · Puesto 1, ¿venís?',
    );
  });

  it('¿Venís? es respuesta; la cobertura común y el retenido no', () => {
    assert.equal(isAvisoEntrante({ type: 'CONVOCATORIA_COBERTURA', title: '¿Venís?' }), true);
    assert.equal(isAvisoEntrante({ type: 'CONVOCATORIA_COBERTURA', convType: 'LLEGADA_TARDE' }), true);
    assert.equal(isAvisoEntrante({ type: 'CONVOCATORIA_COBERTURA', title: '¿Nos das una mano?' }), false);
    assert.equal(isRetencionAviso('RETENCION_AVISO'), true);
    assert.equal(isAvisoEntrante({ type: 'RETENCION_AVISO', title: '⛔ Seguís retenido' }), false);
  });

  it('ambos salen por el canal alertas_turno', () => {
    assert.equal(isShiftAlertFcmType('CONVOCATORIA_COBERTURA'), true);
    assert.equal(isShiftAlertFcmType('RETENCION_AVISO'), true);
  });
});
