/**
 * Tarjeta de alerta: sin botones si ya se respondió, venció o la cubrió otro.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/alertaCardState.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertaCuentaPorConfirmar,
  alertaCuentaSinLeer,
  resolveAlertaCard,
  type AlertaCardInput,
} from './alertaCardState';

const now = new Date('2026-09-29T19:35:00-03:00').getTime();
const start = new Date('2026-09-29T00:00:00-03:00');
const end = new Date('2026-09-29T08:00:00-03:00');
const timeout = new Date('2026-09-29T00:16:00-03:00');

function cobertura(partial: Partial<AlertaCardInput> = {}) {
  return resolveAlertaCard({
    type: 'CONVOCATORIA_COBERTURA',
    read: false,
    endTime: end,
    ...partial,
    nowMs: partial.nowMs ?? now,
  });
}

describe('resolveAlertaCard — cobertura', () => {
  it('PENDING dentro del plazo muestra Aceptar/Rechazar', () => {
    const early = new Date('2026-09-29T00:14:00-03:00').getTime();
    const s = cobertura({
      nowMs: early,
      conv: { status: 'PENDING', timeoutAt: timeout, endTime: end },
    });
    assert.equal(s.showCoverageButtons, true);
    assert.equal(s.showVenisButton, false);
    assert.equal(s.closed, false);
    assert.equal(s.label, null);
  });

  it('LLEGADA_TARDE no muestra Aceptar/Rechazar: abre ¿Venís?', () => {
    const early = new Date('2026-09-29T00:14:00-03:00').getTime();
    const s = cobertura({
      nowMs: early,
      title: '¿Venís?',
      conv: { status: 'PENDING', type: 'LLEGADA_TARDE', timeoutAt: timeout, endTime: end },
    });
    assert.equal(s.showCoverageButtons, false);
    assert.equal(s.showVenisButton, true);
  });

  it('19 h después el hueco terminó: Vencida, sin botones', () => {
    const s = cobertura({ conv: { status: 'PENDING', timeoutAt: timeout, endTime: end } });
    assert.equal(s.closed, true);
    assert.equal(s.showCoverageButtons, false);
    assert.equal(s.label, 'Vencida');
  });

  it('TIMEOUT, EXPIRED y plazo vencido aunque siga PENDING', () => {
    assert.equal(cobertura({ conv: { status: 'TIMEOUT', timeoutAt: timeout } }).label, 'Vencida');
    assert.equal(cobertura({ conv: { status: 'EXPIRED' } }).label, 'Vencida');
    const s = cobertura({
      nowMs: timeout.getTime() + 1000,
      endTime: new Date('2026-09-29T08:00:00-03:00'),
      conv: { status: 'PENDING', timeoutAt: timeout, endTime: end },
    });
    assert.equal(s.label, 'Vencida');
    assert.equal(s.showCoverageButtons, false);
  });

  it('ACCEPTED / REJECTED / CANCELLED / cubierta por otro', () => {
    assert.equal(cobertura({ conv: { status: 'ACCEPTED', respondedAt: timeout } }).label, 'Aceptada');
    assert.equal(cobertura({ conv: { status: 'REJECTED', respondedAt: timeout } }).label, 'Rechazada');
    assert.equal(cobertura({ conv: { status: 'CANCELLED' } }).label, 'Cancelada por Operaciones');
    assert.equal(
      cobertura({ conv: { status: 'CANCELLED', cancelReason: 'ALREADY_COVERED' } }).label,
      'Cubierta por otro',
    );
    assert.equal(
      cobertura({ conv: { status: 'CANCELLED', cancelReason: 'FULL' } }).label,
      'Cubierta por otro',
    );
  });

  it('al tocar Aceptar la tarjeta queda Aceptada al instante, sin botón verde', () => {
    const at = new Date('2026-09-29T00:14:30-03:00').getTime();
    const s = cobertura({
      nowMs: at,
      conv: { status: 'PENDING', timeoutAt: timeout, endTime: end },
      local: { kind: 'ACCEPTED', atMs: at },
    });
    assert.equal(s.label, 'Aceptada');
    assert.equal(s.atMs, at);
    assert.equal(s.showCoverageButtons, false);
  });
});

describe('resolveAlertaCard — acuse y contadores', () => {
  it('Me enteré cierra la tarjeta como Enterado', () => {
    const at = now;
    const s = resolveAlertaCard({
      type: 'TURNO_NUEVO',
      needsAck: true,
      read: false,
      nowMs: now,
      local: { kind: 'ACK', atMs: at },
    });
    assert.equal(s.label, 'Enterado');
    assert.equal(s.showAckButton, false);
    assert.equal(alertaCuentaPorConfirmar({
      type: 'TURNO_NUEVO',
      needsAck: true,
      read: false,
      nowMs: now,
      local: { kind: 'ACK', atMs: at },
    }), false);
  });

  it('sin leer y por confirmar no cuentan respondidas ni vencidas', () => {
    const abierta = {
      type: 'CONVOCATORIA_COBERTURA',
      read: false,
      nowMs: new Date('2026-09-29T00:14:00-03:00').getTime(),
      conv: { status: 'PENDING', timeoutAt: timeout, endTime: end },
    };
    const vencida = {
      type: 'CONVOCATORIA_COBERTURA',
      read: false,
      nowMs: now,
      conv: { status: 'TIMEOUT', timeoutAt: timeout, endTime: end },
    };
    const aceptada = {
      type: 'CONVOCATORIA_COBERTURA',
      read: false,
      nowMs: now,
      conv: { status: 'ACCEPTED', respondedAt: timeout, endTime: end },
    };
    assert.equal(alertaCuentaSinLeer(abierta), true);
    assert.equal(alertaCuentaSinLeer(vencida), false);
    assert.equal(alertaCuentaSinLeer(aceptada), false);
    assert.equal(alertaCuentaPorConfirmar({ ...vencida, needsAck: true }), false);
    assert.equal(
      alertaCuentaPorConfirmar({
        type: 'TURNO_NUEVO',
        needsAck: true,
        read: false,
        nowMs: now,
      }),
      true,
    );
  });
});

describe('resolveAlertaCard — consulta cerrada', () => {
  it('el cupo y la cancelación quedan en una línea, sin botones', () => {
    const cubierta = resolveAlertaCard({ type: 'CONSULTA_CUBIERTA', read: false, nowMs: now });
    assert.equal(cubierta.closed, true);
    assert.equal(cubierta.label, 'Ya se asignó a otra persona');
    assert.equal(cubierta.showCoverageButtons, false);
    const cancelada = resolveAlertaCard({ type: 'CONSULTA_CANCELADA', read: false, nowMs: now });
    assert.equal(cancelada.closed, true);
    assert.equal(cancelada.label, 'Ya no hace falta');
  });
});
