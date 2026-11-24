/**
 * npx tsx --test apps/functions/src/rrhh/experienciaObjetivosCalc.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acumularExperiencia,
  clasificarTurnoExperiencia,
  mezclarExperiencia,
  nivelExperiencia,
  type TurnoExperiencia,
} from './experienciaObjetivosCalc';

const AHORA = Date.UTC(2026, 10, 24, 12, 0, 0);
const AYER = AHORA - 86_400_000;
const MANANA = AHORA + 86_400_000;

const turno = (extra: Partial<TurnoExperiencia> = {}): TurnoExperiencia => ({
  employeeId: 'e1',
  objectiveId: 'o1',
  code: 'M',
  startMs: AYER,
  ...extra,
});

describe('clasificarTurnoExperiencia', () => {
  it('cuenta un turno regular ya trabajado', () => {
    const c = clasificarTurnoExperiencia(turno({ positionName: 'Puesto 1' }), AHORA);
    assert.equal(c?.campo, 'turnosRegulares');
    assert.equal(c?.puesto, 'Puesto 1');
  });

  it('no cuenta futuros, borradores, ausencias, francos ni licencias', () => {
    assert.equal(clasificarTurnoExperiencia(turno({ startMs: MANANA }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ draft: true }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ isAbsent: true }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ status: 'SUPERSEDED' }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ code: 'F' }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ code: 'V' }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ employeeId: 'VACANTE' }), AHORA), null);
  });

  it('RET en stand-by no cuenta; cubriendo cuenta como convocado', () => {
    assert.equal(clasificarTurnoExperiencia(turno({ code: 'RET' }), AHORA), null);
    assert.equal(clasificarTurnoExperiencia(turno({ origin: 'OPERATIONS_COVERAGE' }), AHORA)?.campo, 'turnosConvocado');
    assert.equal(clasificarTurnoExperiencia(turno({ code: 'FT' }), AHORA)?.campo, 'turnosConvocado');
  });

  it('ESC y REF tienen su propio contador', () => {
    assert.equal(clasificarTurnoExperiencia(turno({ code: 'ESC' }), AHORA)?.campo, 'turnosEscuela');
    assert.equal(clasificarTurnoExperiencia(turno({ code: 'REF' }), AHORA)?.campo, 'turnosRefuerzo');
  });
});

describe('nivelExperiencia', () => {
  it('titular, conocido por turnos y por escuela', () => {
    assert.equal(nivelExperiencia({}, true), 'TITULAR');
    assert.equal(nivelExperiencia({ turnosRegulares: 3 }, false), 'CONOCIDO');
    assert.equal(nivelExperiencia({ turnosRegulares: 2 }, false), 'NINGUNO');
    assert.equal(nivelExperiencia({ turnosEscuela: 1 }, false), 'ESCUELA');
    assert.equal(nivelExperiencia({ turnosEscuela: 3 }, false), 'CONOCIDO');
  });
});

describe('mezclarExperiencia', () => {
  const turnos = [
    turno({ positionName: 'Puesto 1' }),
    turno({ startMs: AYER - 1000 }),
    turno({ startMs: AYER - 2000 }),
    turno({ objectiveId: 'o2' }),
  ];
  const porObjetivo = acumularExperiencia(turnos, AHORA, new Set(['e1'])).get('e1')!;

  it('suma contadores, puestos y nivel', () => {
    const r = mezclarExperiencia({ preferredObjectiveId: 'o2' }, porObjetivo);
    assert.ok(r);
    assert.equal(r.experiencia.o1.turnosRegulares, 3);
    assert.equal(r.experiencia.o1.nivel, 'CONOCIDO');
    assert.deepEqual(r.experiencia.o1.posicionesConocidas, ['Puesto 1']);
    assert.equal(r.experiencia.o2.nivel, 'TITULAR');
    assert.equal(r.ultimaPresenciaMs.o1, AYER);
  });

  it('nunca baja un contador existente', () => {
    const r = mezclarExperiencia(
      { experienciaObjetivos: { o1: { turnosRegulares: 10, turnosEscuela: 2 } } },
      porObjetivo,
    );
    assert.ok(r);
    assert.equal(r.experiencia.o1.turnosRegulares, 10);
    assert.equal(r.experiencia.o1.turnosEscuela, 2);
  });

  it('devuelve null si no hay nada que cambiar', () => {
    const primera = mezclarExperiencia({}, porObjetivo)!;
    const segunda = mezclarExperiencia(
      {
        experienciaObjetivos: primera.experiencia,
        ultimaPresenciaPrevia: primera.ultimaPresenciaMs,
      },
      porObjetivo,
    );
    assert.equal(segunda, null);
  });

  it('ignora turnos de guardias que no están en los legajos', () => {
    assert.equal(acumularExperiencia(turnos, AHORA, new Set(['otro'])).size, 0);
  });
});
