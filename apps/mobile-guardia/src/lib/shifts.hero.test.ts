/**
 * Tests hero Hoy — franco + ops_cov / retención / en curso.
 * node --experimental-strip-types --test src/lib/shifts.hero.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  heroShift,
  isRestFrancoShift,
  pickTodayWorkShift,
  type HeroShiftLike,
} from './heroShiftSelection.ts';

function shift(partial: Record<string, unknown>): HeroShiftLike {
  return { id: String(partial.id || 'x'), ...partial };
}

describe('isRestFrancoShift', () => {
  it('F / isFranco = descanso; FT y OPERATIONS_COVERAGE no', () => {
    assert.equal(isRestFrancoShift(shift({ code: 'F', isFranco: true })), true);
    assert.equal(isRestFrancoShift(shift({ code: 'FF' })), true);
    assert.equal(isRestFrancoShift(shift({ code: 'FT', isFrancoTrabajado: true })), false);
    assert.equal(
      isRestFrancoShift(
        shift({ code: 'FT', origin: 'OPERATIONS_COVERAGE', employeeId: 'e1' }),
      ),
      false,
    );
  });
});

describe('heroShift — Barrionuevo: franco + ops_cov 15–23', () => {
  const franco = shift({
    id: '1d10zBOkz635MaNhNouG',
    employeeId: 'hzHO3PUA0Bo5DwZwHlG2',
    code: 'F',
    isFranco: true,
    startTime: '2026-09-26T00:00:00-03:00',
    endTime: '2026-09-26T23:59:59-03:00',
  });
  const opsCov = shift({
    id: 'ops_cov_lXLFk2F33HRiAsQpmoqS_hzHO3PUA0Bo5DwZwHlG2',
    employeeId: 'hzHO3PUA0Bo5DwZwHlG2',
    code: 'FT',
    origin: 'OPERATIONS_COVERAGE',
    startTime: '2026-09-26T15:00:00-03:00',
    endTime: '2026-09-26T23:00:00-03:00',
    isPresent: true,
  });

  it('durante la franja 15–23 el hero es ops_cov (no Próximo / no franco)', () => {
    const now = new Date('2026-09-26T16:30:00-03:00');
    const hero = heroShift([franco, opsCov], now, { empDocId: 'hzHO3PUA0Bo5DwZwHlG2' });
    assert.equal(hero?.id, opsCov.id);
  });

  it('antes de las 15:00 el hero es ops_cov (único trabajo del día; franco ignorado)', () => {
    const now = new Date('2026-09-26T10:00:00-03:00');
    const hero = heroShift([franco, opsCov], now, { empDocId: 'hzHO3PUA0Bo5DwZwHlG2' });
    assert.equal(hero?.id, opsCov.id);
  });

  it('pickTodayWorkShift ignora franco aunque sea el primero del día', () => {
    const now = new Date('2026-09-26T16:00:00-03:00');
    assert.equal(pickTodayWorkShift([franco, opsCov], now)?.id, opsCov.id);
  });
});

describe('heroShift — bordes retención y turno propio + cobertura', () => {
  it('(a) retenido después de endTime sigue siendo hero', () => {
    const retenido = shift({
      id: 'ret-1',
      employeeId: 'e1',
      code: 'M',
      isRetention: true,
      isPresent: true,
      startTime: '2026-09-26T06:00:00-03:00',
      endTime: '2026-09-26T14:00:00-03:00',
    });
    const later = shift({
      id: 'later',
      employeeId: 'e1',
      code: 'T',
      startTime: '2026-09-26T15:00:00-03:00',
      endTime: '2026-09-26T23:00:00-03:00',
    });
    const now = new Date('2026-09-26T15:30:00-03:00');
    assert.equal(heroShift([retenido, later], now, { empDocId: 'e1' })?.id, 'ret-1');
  });

  it('(b) propio en curso + cobertura futura → hero = propio en curso', () => {
    const propio = shift({
      id: 'own-m',
      employeeId: 'e1',
      code: 'M',
      startTime: '2026-09-26T06:00:00-03:00',
      endTime: '2026-09-26T14:00:00-03:00',
    });
    const cov = shift({
      id: 'ops-later',
      employeeId: 'e1',
      code: 'FT',
      origin: 'OPERATIONS_COVERAGE',
      startTime: '2026-09-26T15:00:00-03:00',
      endTime: '2026-09-26T23:00:00-03:00',
    });
    const now = new Date('2026-09-26T10:00:00-03:00');
    assert.equal(heroShift([propio, cov], now, { empDocId: 'e1' })?.id, 'own-m');
  });

  it('(b) propio terminado + cobertura en curso → hero = cobertura', () => {
    const propio = shift({
      id: 'own-m',
      employeeId: 'e1',
      code: 'M',
      startTime: '2026-09-26T06:00:00-03:00',
      endTime: '2026-09-26T14:00:00-03:00',
    });
    const cov = shift({
      id: 'ops-now',
      employeeId: 'e1',
      code: 'FT',
      origin: 'OPERATIONS_COVERAGE',
      startTime: '2026-09-26T15:00:00-03:00',
      endTime: '2026-09-26T23:00:00-03:00',
    });
    const now = new Date('2026-09-26T16:00:00-03:00');
    assert.equal(heroShift([propio, cov], now, { empDocId: 'e1' })?.id, 'ops-now');
  });

  it('ops_cov ADVANCE/EXTEND de registro no es hero (Nuevo Edificio Demo)', () => {
    const own = shift({
      id: 'own-adv',
      employeeId: 'e1',
      code: 'T',
      isEarlyStart: true,
      startTime: '2026-09-28T16:00:00-03:00',
      endTime: '2026-09-28T20:00:00-03:00',
    });
    const trace = shift({
      id: 'ops_cov_adv_bogus',
      employeeId: 'e1',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'ADVANCE',
      startTime: '2026-09-28T08:00:00-03:00',
      endTime: '2026-09-28T12:00:00-03:00',
    });
    const now = new Date('2026-09-28T09:00:00-03:00');
    assert.equal(heroShift([trace, own], now, { empDocId: 'e1' })?.id, 'own-adv');
  });
});
