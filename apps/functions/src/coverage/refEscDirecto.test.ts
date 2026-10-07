/**
 * npx tsx --test src/coverage/refEscDirecto.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asistenciaAntesDeVentana,
  esRefOEsc,
  fichadaAbreMs,
  refEscMismoObjetivo,
  textoTurnoActualizado,
} from './refEscDirecto.ts';

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });
const start = ts('2026-10-07T10:45:00-03:00');
const end = ts('2026-10-07T12:00:00-03:00');

describe('REF/ESC mismo objetivo', () => {
  const source = {
    objectiveId: 'peaje',
    code: 'REF',
    deploymentBand: 'M',
    startTime: start,
    endTime: end,
  };

  it('mismo objetivo y horario que cubre el hueco', () => {
    assert.equal(esRefOEsc('REF') && esRefOEsc('esc'), true);
    assert.equal(esRefOEsc('RET'), false);
    assert.equal(refEscMismoObjetivo({
      type: 'REF',
      source,
      objectiveId: 'peaje',
      startTime: start,
      endTime: end,
      shiftCode: 'M',
    }), true);
  });

  it('otro objetivo no es directo', () => {
    assert.equal(refEscMismoObjetivo({
      type: 'REF',
      source: { ...source, objectiveId: 'otro' },
      objectiveId: 'peaje',
      startTime: start,
      endTime: end,
      shiftCode: 'M',
    }), false);
  });

  it('RET no se toca', () => {
    assert.equal(refEscMismoObjetivo({
      type: 'RET',
      source,
      objectiveId: 'peaje',
      startTime: start,
      endTime: end,
      shiftCode: 'M',
    }), false);
  });

  it('aviso informativo', () => {
    assert.equal(
      textoTurnoActualizado({ code: 'M', objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1' }),
      'Tu turno fue actualizado a Turno Mañana (M) en Peaje 9 Norte · Puesto 1.',
    );
  });

  it('sin pregunta de asistencia antes de T−5; fichada desde T−15 si faltan más de 15 min', () => {
    const gap = start.toMillis();
    const acepto = gap - 17 * 60_000;
    assert.equal(asistenciaAntesDeVentana(gap, acepto), true);
    assert.equal(asistenciaAntesDeVentana(gap, gap - 4 * 60_000), false);
    assert.equal(fichadaAbreMs(gap, acepto), gap - 15 * 60_000);
    assert.equal(start.toMillis() > 0, true);
    assert.equal(fichadaAbreMs(gap, gap - 5 * 60_000), gap - 5 * 60_000);
  });
});
