/**
 * El objetivo de revisión Play queda fuera del Centro de Control y de los crons.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/playReviewFiltros.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_EMAIL,
  REVIEW_OBJECTIVE_ID,
  buildReviewClient,
  buildReviewObjective,
} from '../../../../scripts/crear-usuario-review-play.mjs';
import {
  isExcluidoDeOperacion as isOps,
  turnoFueraDeCentroDeControl as turnoOps,
} from '../../../../packages/ops-core/src/excluirDeOperacion.ts';
import {
  isExcluidoDeOperacion as isFn,
  turnoFueraDeCentroDeControl as turnoFn,
} from '../../../../apps/functions/src/common/excluirDeOperacion.ts';
import { simulableShiftSkipReason } from '../../../../apps/functions/src/common/simulableShift.ts';

describe('revisión Play — fuera de operación', () => {
  it('el mail de Auth es cosp@bacarsa.com.ar y el objetivo lleva el flag', () => {
    assert.equal(REVIEW_EMAIL, 'cosp@bacarsa.com.ar');
    const objective = buildReviewObjective();
    const client = buildReviewClient();
    assert.equal(objective.id, REVIEW_OBJECTIVE_ID);
    assert.equal(objective.excluirDeOperacion, true);
    assert.equal(client.excluirDeOperacion, true);
    assert.equal(client.reviewPlay, true);
    assert.equal(client.objetivos[0].excluirDeOperacion, true);
  });

  it('ops-core y functions leen el mismo flag', () => {
    const shift = { excluirDeOperacion: true, objectiveId: 'otro' };
    const plain = { objectiveId: REVIEW_OBJECTIVE_ID, code: 'M' };
    const ids = new Set([REVIEW_OBJECTIVE_ID]);
    assert.equal(isOps(shift), isFn(shift));
    assert.equal(isOps(plain), false);
    assert.equal(turnoOps(shift, ids), turnoFn(shift, ids));
    assert.equal(turnoOps(plain, ids), true);
    assert.equal(turnoFn({ objectiveId: 'puesto_real' }, ids), false);
    assert.equal(simulableShiftSkipReason(shift), 'FUERA_OPERACION');
    assert.equal(simulableShiftSkipReason(plain), null);
  });
});
