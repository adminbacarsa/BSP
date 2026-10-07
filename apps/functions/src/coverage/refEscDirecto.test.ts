/**
 * npx tsx --test src/coverage/refEscDirecto.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escenarioCobertura, retenerSalientePorLlegada } from '../common/convocadoEta.ts';
import {
  asistenciaAntesDeVentana,
  esRefOEsc,
  esRet,
  fichadaAbreMs,
  refEscMismoObjetivo,
  textoAsignacionRet,
  textoRetAnticipado,
  textoTurnoActualizado,
} from './refEscDirecto.ts';

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });
const start = ts('2026-10-07T10:45:00-03:00');
const end = ts('2026-10-07T12:00:00-03:00');

describe('escenario de cobertura', () => {
  const gap = new Date('2026-10-07T10:45:00-03:00').getTime();
  const min = 60_000;

  it('61 min es anticipada, 59 min y ya empezado son urgente', () => {
    assert.equal(escenarioCobertura({ gapStartMs: gap, nowMs: gap - 61 * min }), 'ANTICIPADA');
    assert.equal(escenarioCobertura({ gapStartMs: gap, nowMs: gap - 60 * min }), 'URGENTE');
    assert.equal(escenarioCobertura({ gapStartMs: gap, nowMs: gap - 59 * min }), 'URGENTE');
    assert.equal(escenarioCobertura({ gapStartMs: gap, nowMs: gap + 5 * min }), 'URGENTE');
  });

  it('el umbral de la empresa mueve la frontera', () => {
    assert.equal(escenarioCobertura({ gapStartMs: gap, nowMs: gap - 31 * min, umbralMin: 30 }), 'ANTICIPADA');
    assert.equal(escenarioCobertura({ gapStartMs: gap, nowMs: gap - 30 * min, umbralMin: 30 }), 'URGENTE');
  });

  it('retiene al saliente si el hueco ya empezó o empieza antes de la llegada', () => {
    assert.equal(retenerSalientePorLlegada({ gapStartMs: gap, nowMs: gap + min, etaMinutes: 5 }), true);
    assert.equal(retenerSalientePorLlegada({ gapStartMs: gap, nowMs: gap - 3 * min, etaMinutes: 5 }), true);
    assert.equal(retenerSalientePorLlegada({ gapStartMs: gap, nowMs: gap - 59 * min, etaMinutes: 5 }), false);
  });

  it('aviso anticipado del RET', () => {
    assert.equal(textoRetAnticipado({
      nombre: 'Laura',
      cuando: 'hoy',
      hora: '10:45',
      clientName: 'Cliente',
      objectiveName: 'Peaje 9 Norte',
      positionName: 'Puesto 1',
      code: 'M',
      desde: '10:45',
      hasta: '12:00',
    }), 'Laura, hoy a las 10:45 cubrís Cliente · Peaje 9 Norte · Puesto 1, M 10:45–12:00.');
  });
});

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

  it('RET no es el atajo de REF mismo objetivo', () => {
    assert.equal(esRet('RET'), true);
    assert.equal(esRet('ref'), false);
    assert.equal(refEscMismoObjetivo({
      type: 'RET',
      source,
      objectiveId: 'peaje',
      startTime: start,
      endTime: end,
      shiftCode: 'M',
    }), false);
  });

  it('aviso del RET: a las HH:MM si el hueco es futuro, lo antes posible si ya empezó', () => {
    const lugar = {
      nombre: 'Laura',
      clientName: 'Cliente',
      objectiveName: 'Peaje 9 Norte',
      positionName: 'Puesto 1',
      code: 'M',
      desde: '10:45',
      hasta: '12:00',
    };
    assert.equal(
      textoAsignacionRet({ ...lugar, huecoFuturo: true, horaLlegada: '10:45' }),
      'Laura, se te asignó cubrir Cliente · Peaje 9 Norte · Puesto 1, M 10:45–12:00. Presentate a las 10:45.',
    );
    assert.equal(
      textoAsignacionRet({ ...lugar, huecoFuturo: false }),
      'Laura, se te asignó cubrir Cliente · Peaje 9 Norte · Puesto 1, M 10:45–12:00. Presentate lo antes posible.',
    );
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
