import { describe, expect, it } from 'vitest';
import {
  categoryFromAbsenceCode,
  coverageResultanteHours,
  gapsToFetch,
  isRangeCovered,
  mergeIntervals,
  type MsRange,
} from './analisisQueries';

describe('mergeIntervals', () => {
  it('fusiona intervalos solapados o contiguos', () => {
    const input: MsRange[] = [
      { startMs: 0, endMs: 100 },
      { startMs: 50, endMs: 200 },
      { startMs: 300, endMs: 400 },
    ];
    expect(mergeIntervals(input)).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 300, endMs: 400 },
    ]);
  });

  it('devuelve vacío si no hay intervalos', () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('isRangeCovered', () => {
  const cached: MsRange[] = [{ startMs: 1000, endMs: 5000 }];

  it('detecta cobertura total del rango pedido', () => {
    expect(isRangeCovered(cached, { startMs: 2000, endMs: 4000 })).toBe(true);
  });

  it('detecta hueco fuera del intervalo cacheado', () => {
    expect(isRangeCovered(cached, { startMs: 0, endMs: 999 })).toBe(false);
  });
});

describe('gapsToFetch', () => {
  it('devuelve el rango completo si no hay cache', () => {
    const req = { startMs: 0, endMs: 1000 };
    expect(gapsToFetch([], req)).toEqual([req]);
  });

  it('parte el rango cuando hay un intervalo en el medio', () => {
    const cached: MsRange[] = [{ startMs: 400, endMs: 600 }];
    expect(gapsToFetch(cached, { startMs: 0, endMs: 1000 })).toEqual([
      { startMs: 0, endMs: 399 },
      { startMs: 601, endMs: 1000 },
    ]);
  });
});

describe('coverageResultanteHours', () => {
  it('suma plan + ext + adel + ops redondeado a 1 decimal', () => {
    expect(
      coverageResultanteHours({ planHours: 100, extHours: 12.04, adelHours: 8, opsHours: 0 }),
    ).toBe(120);
  });
});

describe('categoryFromAbsenceCode', () => {
  it('clasifica códigos CCT conocidos', () => {
    expect(categoryFromAbsenceCode('V')).toBe('vac');
    expect(categoryFromAbsenceCode('A')).toBe('art');
    expect(categoryFromAbsenceCode('AA')).toBe('inj');
    expect(categoryFromAbsenceCode('E')).toBe('enf');
    expect(categoryFromAbsenceCode('L')).toBe('otros');
  });

  it('detecta ART en enfermedad por flag o motivo', () => {
    expect(categoryFromAbsenceCode('E', { isART: true })).toBe('art');
    expect(categoryFromAbsenceCode('E', { reason: 'accidente ART' })).toBe('art');
  });
});
