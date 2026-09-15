import { describe, expect, it } from 'vitest';
import {
  CCT_HS_TECHO_MENSUAL,
  cctTechoHsPerGuard,
  threeMonthLookback,
} from './analisisBolsa';

describe('threeMonthLookback', () => {
  it('toma los 3 meses calendario cerrados anteriores al mes del período', () => {
    const periodStart = new Date(2026, 7, 1); // agosto 2026
    const lb = threeMonthLookback(periodStart);
    expect(lb.months).toBe(3);
    expect(lb.start.getFullYear()).toBe(2026);
    expect(lb.start.getMonth()).toBe(4); // mayo
    expect(lb.end.getFullYear()).toBe(2026);
    expect(lb.end.getMonth()).toBe(6); // julio
    expect(lb.label).toContain('May');
    expect(lb.label).toContain('Jul');
  });
});

describe('cctTechoHsPerGuard', () => {
  it('aplica techo CCT 200 hs/mes por modo de período', () => {
    expect(cctTechoHsPerGuard('month', 30)).toBe(CCT_HS_TECHO_MENSUAL);
    expect(cctTechoHsPerGuard('quarter', 90)).toBe(600);
    expect(cctTechoHsPerGuard('semester', 180)).toBe(1200);
    expect(cctTechoHsPerGuard('year', 365)).toBe(2400);
  });

  it('prorratea días sueltos respecto de 30 días', () => {
    expect(cctTechoHsPerGuard('day', 15)).toBe(100);
  });
});
