/**
 * Reportes: la duración de un turno cortado es la suma de los tramos (10–13 + 14–17 = 6 h),
 * aunque Operaciones haya corrido `endTime` al fin del último tramo (fin − inicio = 7 h).
 *
 * Importa useReportes (inicializa Firebase): correr con NEXT_PUBLIC_FIREBASE_API_KEY=test-key,
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo.firebaseapp.com y NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:1.
 *
 * npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/planificacion/turnoCortadoDuracionReporte.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveShiftDurationHours } from '../../hooks/useReportes';

function ts(iso: string) {
  const d = new Date(iso);
  return { seconds: Math.floor(d.getTime() / 1000), toDate: () => d, toMillis: () => d.getTime() };
}

const BLOQUES = [{ startTime: '10:00', endTime: '13:00' }, { startTime: '14:00', endTime: '17:00' }];

describe('turno cortado: duración en reportes', () => {
  it('endTime corrido al tramo 2: 6 h, no 7', () => {
    const h = resolveShiftDurationHours({
      code: 'CO',
      hours: 6,
      blocks: BLOQUES,
      startTime: ts('2026-11-18T10:00:00-03:00'),
      endTime: ts('2026-11-18T17:00:00-03:00'),
    } as never);
    assert.equal(h, 6);
  });

  it('turno común no cambia', () => {
    const h = resolveShiftDurationHours({
      code: 'M',
      hours: 8,
      startTime: ts('2026-11-18T07:00:00-03:00'),
      endTime: ts('2026-11-18T15:00:00-03:00'),
    });
    assert.equal(h, 8);
  });
});
