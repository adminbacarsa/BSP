import { describe, expect, it } from 'vitest';
import { isOperationalOriginShift } from './operationalShift';

describe('isOperationalOriginShift', () => {
  it.each(['RETEN', 'OPERATIONS_COVERAGE', 'SLA_VIRTUAL', ' reten '])(
    'reconoce origin %s',
    (origin) => {
      expect(isOperationalOriginShift({ origin })).toBe(true);
    },
  );

  it('reconoce los marcadores operativos alternativos', () => {
    expect(isOperationalOriginShift({ isReten: true })).toBe(true);
    expect(isOperationalOriginShift({ resolvedBy: 'operaciones' })).toBe(true);
  });

  it('no convierte excepciones de cada módulo en regla canónica', () => {
    expect(isOperationalOriginShift({ origin: 'CLIENT_REQUEST' })).toBe(false);
    expect(isOperationalOriginShift({ origin: 'EVENTO' })).toBe(false);
    expect(isOperationalOriginShift({ resolvedBy: 'MODO_DEMO' })).toBe(false);
    expect(isOperationalOriginShift(null)).toBe(false);
  });
});
