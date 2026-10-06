/**
 * Fecha visible del turno: Hoy / Mañana / «Sáb 17/10», y el cruce de medianoche.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/fechaTurno.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaDiaYmd, formatCuandoDesdePartes, formatCuandoTurno, formatLineaJornada } from './fechaTurno';

const AHORA = new Date('2026-10-06T12:00:00-03:00');

describe('etiqueta de día', () => {
  it('Hoy, Mañana y día de semana', () => {
    assert.equal(etiquetaDiaYmd('2026-10-06', AHORA), 'Hoy');
    assert.equal(etiquetaDiaYmd('2026-10-07', AHORA), 'Mañana');
    assert.equal(etiquetaDiaYmd('2026-10-17', AHORA), 'Sáb 17/10');
  });
});

describe('formatCuandoTurno', () => {
  it('próximo turno que no es hoy: Sáb 17/10 · 10:00–20:00', () => {
    assert.equal(
      formatCuandoTurno('2026-10-17T10:00:00-03:00', '2026-10-17T20:00:00-03:00', AHORA),
      'Sáb 17/10 · 10:00–20:00',
    );
  });

  it('hoy y mañana llevan la palabra, no la fecha larga', () => {
    assert.equal(
      formatCuandoTurno('2026-10-06T10:00:00-03:00', '2026-10-06T20:00:00-03:00', AHORA),
      'Hoy · 10:00–20:00',
    );
    assert.equal(
      formatCuandoTurno('2026-10-07T08:00:00-03:00', '2026-10-07T16:00:00-03:00', AHORA),
      'Mañana · 08:00–16:00',
    );
  });

  it('si cruza medianoche etiqueta los dos días', () => {
    assert.equal(
      formatCuandoTurno('2026-10-06T23:00:00-03:00', '2026-10-07T07:00:00-03:00', AHORA),
      'Hoy 23:00–Mañana 07:00',
    );
    assert.equal(
      formatCuandoTurno('2026-10-17T22:00:00-03:00', '2026-10-18T06:00:00-03:00', AHORA),
      'Sáb 17/10 22:00–Dom 18/10 06:00',
    );
  });
});

describe('formatCuandoDesdePartes', () => {
  it('la tarjeta de convocatoria usa el mismo criterio, también si el fin es al día siguiente', () => {
    assert.equal(formatCuandoDesdePartes('17/10/2026', '10:00–20:00', AHORA), 'Sáb 17/10 · 10:00–20:00');
    assert.equal(formatCuandoDesdePartes('06/10/2026', '16:00–17:00', AHORA), 'Hoy · 16:00–17:00');
    assert.equal(formatCuandoDesdePartes('12/10/2026', '18:00–02:00', AHORA), 'Lun 12/10 18:00–Mar 13/10 02:00');
  });
});

describe('formatLineaJornada', () => {
  it('consulta: día relativo, código y horario', () => {
    assert.equal(formatLineaJornada('2026-10-07', 'M', '07:00', '15:00', AHORA), 'Mañana · M 07:00–15:00');
    assert.equal(formatLineaJornada('2026-10-17', 'T', '10:00', '20:00', AHORA), 'Sáb 17/10 · T 10:00–20:00');
  });
});
