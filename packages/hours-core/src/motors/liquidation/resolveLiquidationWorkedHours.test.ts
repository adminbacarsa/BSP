import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLiquidationWorkedHours } from './reportesLiquidation.ts';

const ended = { seconds: Math.floor(Date.now() / 1000) - 3600 };

describe('resolveLiquidationWorkedHours', () => {
  it('usa rDur cuando hay fichada completa', () => {
    const n = resolveLiquidationWorkedHours(
      { code: 'C1', endTime: ended, realStartTime: { seconds: ended.seconds - 8 * 3600 } },
      { rDur: 7.5, duration: 8 },
    );
    assert.equal(n, 7.5);
  });

  it('sin egreso pero con presencia: planificado', () => {
    const n = resolveLiquidationWorkedHours(
      {
        code: 'C1',
        endTime: ended,
        presenciaBloques: { b2: { realStartTime: { seconds: ended.seconds - 4 * 3600 } } },
      },
      { rDur: null, duration: 8 },
    );
    assert.equal(n, 8);
  });

  it('TURA sin fichada completa no inventa planificado', () => {
    const n = resolveLiquidationWorkedHours(
      { code: 'TURA', endTime: ended, realStartTime: { seconds: ended.seconds - 3600 } },
      { rDur: null, duration: 4 },
    );
    assert.equal(n, 0);
  });

  it('sin presencia no suma', () => {
    const n = resolveLiquidationWorkedHours(
      { code: 'C1', endTime: ended },
      { rDur: null, duration: 8 },
    );
    assert.equal(n, 0);
  });
});
