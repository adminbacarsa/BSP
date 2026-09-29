/**
 * Paridad evaluateCheckInWindow (portal-core) ↔ evaluateServerCheckInWindow (functions lib).
 * Misma matriz de casos; resultados idénticos. Sin modificar functions.
 *
 * node --experimental-strip-types --test src/lib/checkInWindow.parity.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  evaluateCheckInWindow,
  checkInRejectMessage,
  isCoverageHoursOnSourceDoc,
  lateNoNoticeCheckInCopy,
} from '../../../../packages/portal-core/src/checkIn/evaluateCheckInWindow.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const functionsLib = path.resolve(
  __dirname,
  '../../../../apps/functions/lib/fichajes/checkInWindow.js',
);
const { evaluateServerCheckInWindow } = require(functionsLib) as {
  evaluateServerCheckInWindow: (
    shift: Record<string, unknown>,
    nowMs: number,
    opts?: { source?: string },
  ) => {
    allowed: boolean;
    rejectCode?: string;
    usePlannedStart?: boolean;
    useAdjustedStart?: boolean;
    lateMinutes?: number;
    lateNoNotice?: boolean;
  };
};

/** Timestamp-like compatible con functions (solo .toMillis). */
function ts(iso: string): { toMillis: () => number } {
  const ms = new Date(iso).getTime();
  return { toMillis: () => ms };
}

function assertParity(
  label: string,
  shift: Record<string, unknown>,
  nowMs: number,
  opts?: { source?: string },
) {
  const portal = evaluateCheckInWindow(shift, nowMs, opts);
  const server = evaluateServerCheckInWindow(shift, nowMs, opts);
  assert.deepEqual(
    {
      allowed: portal.allowed,
      rejectCode: portal.rejectCode,
      usePlannedStart: portal.usePlannedStart,
      useAdjustedStart: portal.useAdjustedStart,
      lateMinutes: portal.lateMinutes,
      lateNoNotice: portal.lateNoNotice,
    },
    {
      allowed: server.allowed,
      rejectCode: server.rejectCode,
      usePlannedStart: server.usePlannedStart,
      useAdjustedStart: server.useAdjustedStart,
      lateMinutes: server.lateMinutes,
      lateNoNotice: server.lateNoNotice,
    },
    label,
  );
}

describe('paridad evaluateCheckInWindow ↔ evaluateServerCheckInWindow', () => {
  const day = '2026-09-14';

  it('ausente → ABSENT', () => {
    const shift = {
      isAbsent: true,
      status: 'ABSENT',
      startTime: ts(`${day}T18:00:00-03:00`),
      endTime: ts('2026-09-15T02:00:00-03:00'),
    };
    const now = new Date(`${day}T18:00:00-03:00`).getTime();
    assertParity('absent', shift, now);
    assert.equal(evaluateCheckInWindow(shift, now).rejectCode, 'ABSENT');
  });

  it('normal T−15…T+30: a tiempo hasta T+5; T+5…T+30 sin aviso; T+31 TOO_LATE', () => {
    const start = `${day}T18:00:00-03:00`;
    const shift = {
      origin: 'PLANIFICADOR',
      startTime: ts(start),
      endTime: ts('2026-09-15T02:00:00-03:00'),
    };
    assertParity('too early', shift, new Date(`${day}T17:00:00-03:00`).getTime());
    assertParity('in window', shift, new Date(`${day}T17:50:00-03:00`).getTime());
    assertParity('on time+', shift, new Date(`${day}T18:03:00-03:00`).getTime());
    const t16 = new Date(`${day}T18:16:00-03:00`).getTime();
    assertParity('t+16 no notice', shift, t16);
    const late = evaluateCheckInWindow(shift, t16);
    assert.equal(late.allowed, true);
    assert.equal(late.lateNoNotice, true);
    assert.equal(late.lateMinutes, 16);
    const t31 = new Date(`${day}T18:31:00-03:00`).getTime();
    assertParity('t+31', shift, t31);
    assert.equal(evaluateCheckInWindow(shift, t31).rejectCode, 'TOO_LATE');
  });

  it('lateArrivalEtaAt prioriza sobre minutos; cap T+60', () => {
    const startIso = `${day}T17:00:00-03:00`;
    const shift = {
      startTime: ts(startIso),
      endTime: ts('2026-09-15T01:00:00-03:00'),
      lateArrivalConfirmed: true,
      lateArrivalEtaAt: ts(`${day}T17:45:00-03:00`),
    };
    const etaOk = new Date(`${day}T17:40:00-03:00`).getTime();
    assertParity('eta ok', shift, etaOk);
    assert.equal(evaluateCheckInWindow(shift, etaOk).lateNoNotice, undefined);
    assertParity('eta passed', shift, new Date(`${day}T17:50:00-03:00`).getTime());

    const withCap = {
      ...shift,
      lateArrivalEtaAt: ts(`${day}T19:00:00-03:00`), // > T+60
    };
    assertParity('cap 60', withCap, new Date(`${day}T17:55:00-03:00`).getTime());
    assertParity('cap 60 late', withCap, new Date(`${day}T18:05:00-03:00`).getTime());
  });

  it('lateArrivalAt sin etaAt → tope T+30', () => {
    const shift = {
      startTime: ts(`${day}T17:00:00-03:00`),
      endTime: ts('2026-09-15T01:00:00-03:00'),
      lateArrivalAt: ts(`${day}T16:50:00-03:00`),
    };
    assertParity('t+30 ok', shift, new Date(`${day}T17:25:00-03:00`).getTime());
    assertParity('t+30 late', shift, new Date(`${day}T17:35:00-03:00`).getTime());
  });

  it('convocado: acceptedAt+30 a tiempo, +60 TOO_LATE', () => {
    const shift = {
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'RET',
      startTime: ts(`${day}T15:00:00-03:00`),
      endTime: ts(`${day}T23:00:00-03:00`),
      acceptedAt: ts(`${day}T16:00:00-03:00`),
    };
    const on = evaluateCheckInWindow(shift, new Date(`${day}T16:20:00-03:00`).getTime());
    assert.equal(on.allowed, true);
    assert.equal(on.lateMinutes, 0);
    const late = evaluateCheckInWindow(shift, new Date(`${day}T16:40:00-03:00`).getTime());
    assert.equal(late.lateNoNotice, true);
    assert.equal(late.lateMinutes, 10);
    assert.equal(evaluateCheckInWindow(shift, new Date(`${day}T17:01:00-03:00`).getTime()).rejectCode, 'TOO_LATE');
    assertParity('conv 16:20', shift, new Date(`${day}T16:20:00-03:00`).getTime());
    assertParity('conv 16:40', shift, new Date(`${day}T16:40:00-03:00`).getTime());
    assertParity('conv 17:01', shift, new Date(`${day}T17:01:00-03:00`).getTime());
  });

  it('OPERATIONS_COVERAGE: createdAt / coverageCreatedAt', () => {
    const shift = {
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'FT',
      startTime: ts(`${day}T15:00:00-03:00`),
      endTime: ts(`${day}T23:00:00-03:00`),
      createdAt: ts(`${day}T14:30:00-03:00`),
    };
    assertParity('ops early', shift, new Date(`${day}T14:40:00-03:00`).getTime());
    assertParity('ops in', shift, new Date(`${day}T15:10:00-03:00`).getTime());
    assertParity('ops late', shift, new Date(`${day}T16:05:00-03:00`).getTime());

    const covCreated = {
      origin: 'OPERATIONS_COVERAGE',
      startTime: ts(`${day}T15:00:00-03:00`),
      endTime: ts(`${day}T23:00:00-03:00`),
      coverageCreatedAt: ts(`${day}T15:20:00-03:00`),
    };
    assertParity('coverageCreatedAt', covCreated, new Date(`${day}T16:10:00-03:00`).getTime());
  });

  it('SHIFT_ENDED después de endTime (retenido puede seguir en hero sin fichar)', () => {
    const shift = {
      origin: 'PLANIFICADOR',
      isRetention: true,
      isPresent: true,
      startTime: ts(`${day}T06:00:00-03:00`),
      endTime: ts(`${day}T14:00:00-03:00`),
    };
    assertParity('shift ended', shift, new Date(`${day}T15:30:00-03:00`).getTime());
    assert.equal(evaluateCheckInWindow(shift, new Date(`${day}T15:30:00-03:00`).getTime()).rejectCode, 'SHIFT_ENDED');
  });

  it('isEarlyStart: ventana ADV OR propia', () => {
    const shift = {
      isEarlyStart: true,
      startTime: ts(`${day}T20:00:00-03:00`),
      endTime: ts('2026-09-15T04:00:00-03:00'),
      adjustedStartTime: ts(`${day}T18:00:00-03:00`),
    };
    assertParity('adv window', shift, new Date(`${day}T18:00:00-03:00`).getTime());
    assertParity('between', shift, new Date(`${day}T19:20:00-03:00`).getTime());
    assertParity('own window', shift, new Date(`${day}T19:50:00-03:00`).getTime());
  });

  it('source OPERATIONS/VIGI bypasea ventana', () => {
    const shift = {
      startTime: ts(`${day}T20:00:00-03:00`),
      endTime: ts('2026-09-15T04:00:00-03:00'),
    };
    assertParity('ops source', shift, new Date(`${day}T12:00:00-03:00`).getTime(), {
      source: 'OPERATIONS',
    });
  });

  it('TRACE_REGISTRATION: coverageHoursOnSource y coverageType EXTEND/ADVANCE', () => {
    const flagged = {
      origin: 'OPERATIONS_COVERAGE',
      coverageHoursOnSource: true,
      startTime: ts(`${day}T08:00:00-03:00`),
      endTime: ts(`${day}T12:00:00-03:00`),
    };
    assertParity('flag', flagged, new Date(`${day}T08:30:00-03:00`).getTime());
    assert.equal(isCoverageHoursOnSourceDoc(flagged), true);

    const byType = {
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'ADVANCE',
      startTime: ts(`${day}T08:00:00-03:00`),
      endTime: ts(`${day}T12:00:00-03:00`),
    };
    assertParity('by type ADVANCE', byType, new Date(`${day}T08:30:00-03:00`).getTime());
    assert.equal(evaluateCheckInWindow(byType, new Date(`${day}T08:30:00-03:00`).getTime()).rejectCode, 'TRACE_REGISTRATION');
  });
});

describe('casos reales — CAPS Angelelli 26/09 y Nuevo Edificio 28/09', () => {
  it('Barrionuevo FT ops_cov (CAPS Angelelli 26/09): ventana ops + no es TRACE', () => {
    // Hero FT ops_cov 15–23; sin acceptedAt el ancla es createdAt 14:45 → tope 15:45.
    const opsCov = {
      id: 'ops_cov_lXLFk2F33HRiAsQpmoqS_hzHO3PUA0Bo5DwZwHlG2',
      origin: 'OPERATIONS_COVERAGE',
      code: 'FT',
      startTime: ts('2026-09-26T15:00:00-03:00'),
      endTime: ts('2026-09-26T23:00:00-03:00'),
      createdAt: ts('2026-09-26T14:45:00-03:00'),
      coverageCreatedAt: ts('2026-09-26T14:45:00-03:00'),
    };
    const inWindow = new Date('2026-09-26T15:20:00-03:00').getTime();
    assertParity('barrionuevo in window', opsCov, inWindow);
    const r = evaluateCheckInWindow(opsCov, inWindow);
    assert.equal(r.allowed, true);
    assert.equal(r.rejectCode, undefined);

    const beforeOpen = new Date('2026-09-26T14:40:00-03:00').getTime();
    assertParity('barrionuevo early', opsCov, beforeOpen);
    assert.equal(evaluateCheckInWindow(opsCov, beforeOpen).rejectCode, 'TOO_EARLY');

    // Pasado max(created,start)+60 aunque el turno siga — paridad server (TOO_LATE).
    const afterOpsWindow = new Date('2026-09-26T16:30:00-03:00').getTime();
    assertParity('barrionuevo after ops window', opsCov, afterOpsWindow);
    assert.equal(evaluateCheckInWindow(opsCov, afterOpsWindow).rejectCode, 'TOO_LATE');

    const afterEnd = new Date('2026-09-26T23:05:00-03:00').getTime();
    assertParity('barrionuevo ended', opsCov, afterEnd);
    assert.equal(evaluateCheckInWindow(opsCov, afterEnd).rejectCode, 'SHIFT_ENDED');
  });

  it('Nuevo Edificio 28/09 — ADVANCE Ceballos ops_cov con ventanas absurdas Demo: TRACE, sin romper', () => {
    // Datos erróneos del Demo: franjas 08–12 y 16–20 en docs de registro ADVANCE.
    // El portal no debe ofrecer fichar ni lanzar excepción.
    const bogusMorning = {
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'ADVANCE',
      coverageHoursOnSource: true,
      startTime: ts('2026-09-28T08:00:00-03:00'),
      endTime: ts('2026-09-28T12:00:00-03:00'),
      createdAt: ts('2026-09-28T07:50:00-03:00'),
    };
    const bogusAfternoon = {
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'ADVANCE',
      // Sin flag; detectado por coverageType (paridad isOpsCoverageHoursOnSourceDoc)
      startTime: ts('2026-09-28T16:00:00-03:00'),
      endTime: ts('2026-09-28T20:00:00-03:00'),
      coverageCreatedAt: ts('2026-09-28T15:55:00-03:00'),
    };

    for (const [label, shift, nowIso] of [
      ['am mid', bogusMorning, '2026-09-28T09:00:00-03:00'],
      ['am early', bogusMorning, '2026-09-28T07:00:00-03:00'],
      ['pm mid', bogusAfternoon, '2026-09-28T17:00:00-03:00'],
      ['pm after end', bogusAfternoon, '2026-09-28T21:00:00-03:00'],
    ] as const) {
      const nowMs = new Date(nowIso).getTime();
      assertParity(`ceballos ${label}`, shift, nowMs);
      const r = evaluateCheckInWindow(shift, nowMs);
      assert.equal(r.allowed, false);
      assert.equal(r.rejectCode, 'TRACE_REGISTRATION');
      assert.match(checkInRejectMessage(r.rejectCode), /extensión|adelanto/i);
    }
  });
});

describe('UI llegada tarde sin aviso (T+5…T+30)', () => {
  it('Gaitan ESC 16:00: T+16 sin aviso habilita Llegada tarde; con ETA no', () => {
    const shift = {
      origin: 'PLANIFICADOR',
      code: 'ESC',
      startTime: ts('2026-09-28T16:00:00-03:00'),
      endTime: ts('2026-09-29T00:00:00-03:00'),
    };
    const at16 = new Date('2026-09-28T16:16:00-03:00').getTime();
    assertParity('gaitan t+16', shift, at16);
    const r = evaluateCheckInWindow(shift, at16);
    assert.equal(r.allowed, true);
    assert.equal(r.lateNoNotice, true);
    assert.equal(r.lateMinutes, 16);
    const copy = lateNoNoticeCheckInCopy(r.lateMinutes ?? 0);
    assert.equal(copy.actionLabel, 'Llegada tarde');
    assert.equal(copy.title, 'Llegada tarde');
    assert.equal(copy.subtitle, 'Llegás 16 min tarde; queda registrado.');

    const noticed = {
      ...shift,
      lateArrivalAt: ts('2026-09-28T15:50:00-03:00'),
      lateArrivalEtaAt: ts('2026-09-28T16:45:00-03:00'),
    };
    assertParity('gaitan con aviso', noticed, at16);
    const withNotice = evaluateCheckInWindow(noticed, at16);
    assert.equal(withNotice.allowed, true);
    assert.equal(withNotice.lateNoNotice, undefined);
  });
});

describe('mensajes de rechazo UX', () => {
  it('textos claros por código', () => {
    assert.match(checkInRejectMessage('TOO_EARLY'), /temprano/i);
    assert.match(checkInRejectMessage('SHIFT_ENDED'), /terminó/i);
    assert.match(checkInRejectMessage('TRACE_REGISTRATION'), /extensión|adelanto/i);
    assert.match(checkInRejectMessage('TOO_LATE'), /ventana/i);
  });
});
