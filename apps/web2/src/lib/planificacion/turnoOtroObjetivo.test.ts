import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  celdaOtroObjetivoBloqueada,
  decisionGuardadoTurnoAjeno,
  esTurnoAjenoAlCrono,
  idsObjetivosDelCrono,
  saltearEscrituraTurnoAjeno,
  sanearPendientesTurnoAjeno,
  textoAvisoTurnoAjeno,
} from './turnoOtroObjetivo';

const NINOS = 'ninos';
const CASA = 'casa';
const PEAJE = 'peaje';

describe('turno de otro objetivo', () => {
  it('en la vista simple y en la agrupada la celda ajena no se edita', () => {
    const simple = idsObjetivosDelCrono(NINOS, [NINOS, CASA], false);
    const grupo = idsObjetivosDelCrono(NINOS, [NINOS, CASA], true);
    const turno = { id: 't1', objectiveId: PEAJE, code: 'M' };
    assert.equal(celdaOtroObjetivoBloqueada(turno, simple), true);
    assert.equal(celdaOtroObjetivoBloqueada(turno, grupo), true);
    assert.equal(celdaOtroObjetivoBloqueada({ objectiveId: NINOS }, simple), false);
    assert.equal(celdaOtroObjetivoBloqueada({ objectiveId: CASA }, grupo), false);
    assert.equal(celdaOtroObjetivoBloqueada({ objectiveId: CASA }, simple), true);
    assert.equal(esTurnoAjenoAlCrono('', simple), false);
    assert.equal(esTurnoAjenoAlCrono(null, simple), false);
  });

  it('pegar y la asignación masiva saltean la celda de otro objetivo', () => {
    const simple = idsObjetivosDelCrono(NINOS, null, false);
    const grupo = idsObjetivosDelCrono(NINOS, [NINOS, CASA], true);
    assert.equal(saltearEscrituraTurnoAjeno({ objectiveId: PEAJE }, simple), true);
    assert.equal(saltearEscrituraTurnoAjeno({ objectiveId: PEAJE }, grupo), true);
    assert.equal(saltearEscrituraTurnoAjeno({ objectiveId: CASA }, grupo), false);
    assert.equal(saltearEscrituraTurnoAjeno(null, grupo), false);
    assert.equal(saltearEscrituraTurnoAjeno({ objectiveId: PEAJE, isDeleted: true }, grupo), false);
  });

  it('un cambio pendiente sobre el doc de otro objetivo no se escribe ni se borra', () => {
    const permitidos = idsObjetivosDelCrono(NINOS, [NINOS, CASA], true);
    const docs = [{ id: 'doc-peaje', objectiveId: PEAJE }];
    const decision = decisionGuardadoTurnoAjeno({
      cambio: { isDeleted: false, isSecondBlock: false },
      docs,
      permitidos,
    });
    assert.equal(decision.escribir, false);
    assert.equal(decision.rechazado, true);
    assert.deepEqual(decision.borrarIds, []);

    const saneado = sanearPendientesTurnoAjeno({
      prev: {},
      next: { 'cap_2026-10-02': { code: 'M', objectiveId: NINOS, isTemp: true } },
      docsPorClave: { 'cap_2026-10-02': docs },
      permitidos,
    });
    assert.deepEqual(saneado.changes, {});
    assert.equal(saneado.rechazadas[0].objectiveId, PEAJE);
    assert.equal(textoAvisoTurnoAjeno('CAPDEVILA, GONZALO', 'Peaje Norte'), 'CAPDEVILA, GONZALO tiene turno en Peaje Norte ese día');
  });

  it('borrar el ajeno se rechaza; el segundo bloque crea doc nuevo sin tocarlo', () => {
    const permitidos = idsObjetivosDelCrono(NINOS, null, false);
    const docs = [{ id: 'doc-peaje', objectiveId: PEAJE }];
    const borrado = decisionGuardadoTurnoAjeno({
      cambio: { isDeleted: true },
      docs,
      permitidos,
    });
    assert.equal(borrado.escribir, false);
    assert.deepEqual(borrado.borrarIds, []);

    const segundo = decisionGuardadoTurnoAjeno({
      cambio: { isSecondBlock: true },
      docs,
      permitidos,
    });
    assert.equal(segundo.escribir, true);
    assert.equal(segundo.rechazado, false);
    assert.deepEqual(segundo.borrarIds, []);
  });

  it('si hay turno propio y ajeno, solo se reescribe el propio', () => {
    const permitidos = idsObjetivosDelCrono(NINOS, [NINOS, CASA], true);
    const decision = decisionGuardadoTurnoAjeno({
      cambio: { code: 'T' } as { isDeleted?: boolean },
      docs: [
        { id: 'doc-peaje', objectiveId: PEAJE },
        { id: 'doc-ninos', objectiveId: NINOS },
      ],
      permitidos,
    });
    assert.equal(decision.escribir, true);
    assert.deepEqual(decision.borrarIds, ['doc-ninos']);
  });
});
