import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { codigoGrillaAusenteSinRegistro, turnoDelCronoEnPantalla } from './ausenteSinRegistroCelda';

describe('celda ausente sin doc de ausencias', () => {
  const baez = {
    code: 'M',
    isAbsent: true,
    status: 'ABSENT',
    resolvedBy: 'OPERACIONES',
    objectiveId: 'peaje',
    origin: 'PLANIFICADOR',
    coverageType: 'REF',
    coverageStatus: 'COVERED',
    coveredByEmployeeName: 'LALLANA',
  };

  it('ABSENT sin absenceType se pinta AA', () => {
    assert.equal(codigoGrillaAusenteSinRegistro(baez), 'AA');
    assert.equal(turnoDelCronoEnPantalla(baez, 'peaje', null), true);
  });

  it('si el turno trae absenceType, la celda usa ese código', () => {
    assert.equal(codigoGrillaAusenteSinRegistro({ ...baez, absenceType: 'E' }), 'E');
    assert.equal(codigoGrillaAusenteSinRegistro({ ...baez, absenceType: 'V' }), 'V');
  });

  it('un ops_cov no se convierte en AA del titular', () => {
    assert.equal(codigoGrillaAusenteSinRegistro({ ...baez, origin: 'OPERATIONS_COVERAGE' }), null);
  });

  it('un turno presente no se pinta como ausencia', () => {
    assert.equal(codigoGrillaAusenteSinRegistro({ ...baez, isAbsent: false, status: 'PRESENT' }), null);
  });
});
