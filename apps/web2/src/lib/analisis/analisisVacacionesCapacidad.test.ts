import { describe, expect, it } from 'vitest';
import { buildPlantelVacacionesCapacidad } from './analisisVacacionesCapacidad';

describe('buildPlantelVacacionesCapacidad', () => {
  it('dosifica pendiente anual y estima gap vs holgura', () => {
    const emp = {
      id: 'e1',
      status: 'ACTIVE',
      fechaIngreso: '2015-01-15',
    };
    const r = buildPlantelVacacionesCapacidad({
      employees: [emp],
      ausencias: [],
      turnosPeriodo: [],
      year: 2026,
      monthIndex0: 8, // Sep → 4 meses resto
      bolsaInicialHs: 180,
      hsConsumoTecho: 100,
    });
    expect(r.plantel).toBe(1);
    expect(r.derechoAnualDias).toBeGreaterThan(0);
    expect(r.pendienteDias).toBe(r.derechoAnualDias);
    expect(r.mesesRestantesAnio).toBe(4);
    expect(r.dosisOptimaMensualHs).toBeGreaterThan(0);
    expect(r.soporteSinExtrasHs).toBe(80);
    expect(r.conclusion.length).toBeGreaterThan(10);
  });
});
