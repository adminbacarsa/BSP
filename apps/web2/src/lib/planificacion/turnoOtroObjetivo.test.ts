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

it('F y RET de otro objetivo: F ↔ RET queda en su objetivo; al RET se le asigna un turno de acá; sobre el F no', () => {
  const permitidos = ['obrador'];
  const franco = { id: 'f1', objectiveId: 'banco', code: 'F' };
  const ret = { id: 'r1', objectiveId: 'banco', code: 'RET' };
  const fRet = decisionGuardadoTurnoAjeno({ cambio: { code: 'RET' }, docs: [franco], permitidos });
  assert.deepEqual([fRet.escribir, fRet.objetivoAjeno, fRet.borrarIds], [true, 'banco', ['f1']]);
  const retF = decisionGuardadoTurnoAjeno({ cambio: { code: 'F' }, docs: [ret], permitidos });
  assert.deepEqual([retF.escribir, retF.objetivoAjeno], [true, 'banco']);
  const turno = decisionGuardadoTurnoAjeno({ cambio: { code: 'M' }, docs: [ret], permitidos });
  assert.deepEqual([turno.escribir, turno.objetivoAjeno, turno.borrarIds], [true, undefined, ['r1']]);
  const sobreF = decisionGuardadoTurnoAjeno({ cambio: { code: 'M' }, docs: [franco], permitidos });
  assert.deepEqual([sobreF.escribir, sobreF.motivo], [false, 'franco']);
  const borrar = decisionGuardadoTurnoAjeno({ cambio: { isDeleted: true }, docs: [ret], permitidos });
  assert.equal(borrar.escribir, false);
  const trabajo = decisionGuardadoTurnoAjeno({ cambio: { code: 'RET' }, docs: [{ id: 'm1', objectiveId: 'banco', code: 'M' }], permitidos });
  assert.equal(trabajo.escribir, false);
  assert.equal(celdaOtroObjetivoBloqueada(franco as any, permitidos), false);
  assert.equal(celdaOtroObjetivoBloqueada({ id: 'm1', objectiveId: 'banco', code: 'M' } as any, permitidos), true);
  assert.equal(celdaOtroObjetivoBloqueada({ id: 'ft', objectiveId: 'banco', code: 'F', isFrancoTrabajado: true } as any, permitidos), true);
});
