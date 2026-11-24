/**
 * npx tsx --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/operaciones/respuestasWaGuardia.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ingresoDemasiadoAnticipado,
  textoFueraDeRadioWa,
  textoIngresoAnticipadoWa,
  WA_VENTANA_INGRESO_MS,
} from './respuestasWaGuardia.ts';

const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });

describe('respuestasWaGuardia', () => {
  it('detecta marca a más de 30 min del inicio', () => {
    const start = ts('2026-11-24T14:30:00-03:00');
    const msg = new Date('2026-11-24T13:31:00-03:00').getTime();
    assert.equal(ingresoDemasiadoAnticipado(start, msg), true);
    assert.equal(
      ingresoDemasiadoAnticipado(start, new Date('2026-11-24T14:05:00-03:00').getTime()),
      false,
    );
  });

  it('texto anticipado menciona la ventana de 30 min', () => {
    const startMs = new Date('2026-11-24T14:30:00-03:00').getTime();
    const msg = startMs - WA_VENTANA_INGRESO_MS - 20 * 60_000;
    const t = textoIngresoAnticipadoWa(
      'ACUÑA, JUAN MANUEL',
      { expected: '14:30', obj: 'Casa Matriz', startTimeRaw: ts('2026-11-24T14:30:00-03:00') },
      msg,
    );
    assert.match(t, /14:30/);
    assert.match(t, /30 min/);
    assert.match(t, /Juan/i);
  });

  it('texto fuera de radio incluye metros', () => {
    const t = textoFueraDeRadioWa('ALLASIA, GONZALO', 250, 'ingreso');
    assert.match(t, /250 m/);
    assert.match(t, /80 m/);
  });
});
