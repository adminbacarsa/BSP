/**
 * npx tsx --test src/fichajes/fichadaSobreCobertura.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  camposPresencia,
  mismoHorario,
  parcheFuenteSinHoras,
  turnoFuenteRefEscRet,
  yaFicho,
} from './fichadaSobreCobertura.ts';

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });

describe('fichada sobre la cobertura', () => {
  const horario = {
    startTime: ts('2026-10-07T11:45:00-03:00'),
    endTime: ts('2026-10-07T15:30:00-03:00'),
  };

  it('REF/ESC/RET planificado es fuente; el ops_cov no', () => {
    assert.equal(turnoFuenteRefEscRet({ code: 'REF' }), true);
    assert.equal(turnoFuenteRefEscRet({ code: 'ESC' }), true);
    assert.equal(turnoFuenteRefEscRet({ code: 'RET' }), true);
    assert.equal(turnoFuenteRefEscRet({ code: 'M', origin: 'OPERATIONS_COVERAGE', coverageType: 'REF' }), false);
    assert.equal(turnoFuenteRefEscRet({ code: 'M' }), false);
  });

  it('mismo horario a un minuto', () => {
    assert.equal(mismoHorario(horario, { ...horario }), true);
    assert.equal(mismoHorario(horario, {
      startTime: ts('2026-10-07T11:45:30-03:00'),
      endTime: ts('2026-10-07T15:30:00-03:00'),
    }), true);
    assert.equal(mismoHorario(horario, {
      startTime: ts('2026-10-07T12:00:00-03:00'),
      endTime: ts('2026-10-07T15:30:00-03:00'),
    }), false);
  });

  it('la fuente fichada pasa el reloj y queda sin horas', () => {
    const fuente = {
      ...horario,
      code: 'REF',
      isPresent: true,
      status: 'PRESENT',
      checkInAt: ts('2026-10-07T11:37:08-03:00'),
      realStartTime: ts('2026-10-07T11:45:00-03:00'),
      checkInMethod: 'PORTAL_GPS',
    };
    assert.equal(yaFicho(fuente), true);
    const presencia = camposPresencia(fuente);
    assert.equal(presencia.isPresent, true);
    assert.equal(presencia.checkInAt, fuente.checkInAt);
    const parche = parcheFuenteSinHoras('ops_cov_x', 'titular');
    assert.equal(parche.coverageUsed, true);
    assert.equal(parche.isPresent, false);
    assert.equal(parche.status, 'CANCELLED');
    assert.equal(parche.isDeleted, true);
    assert.equal('realStartTime' in parche, true);
    assert.notEqual(parche.realStartTime, fuente.realStartTime);
  });
});
