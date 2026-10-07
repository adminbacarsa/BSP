/**
 * Llegada del convocado: ventana de fichada, recordatorio y copys EXT/ADV.
 * node --experimental-strip-types --test src/lib/convocadoArrival.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCheckInTiming } from '../../../../packages/portal-core/src/checkIn/portalCheckIn.ts';
import { resolveCheckInUiStatus } from '../../../../packages/portal-core/src/checkIn/checkInUiStatus.ts';
import { formatTimeAr } from '../../../../packages/portal-core/src/utils/dates.ts';
import {
  advanceStartLine,
  convocadoRecordatorioRoute,
  coberturaAceptadaLine,
  extendUntilLine,
  formatEnCaminoLine,
  isRecordatorioPendiente,
  planConvocadoArrival,
  parseConvocadoRecordatorioPush,
  resolveExpectedArrivalAt,
} from '../../../../packages/portal-core/src/checkIn/convocadoArrival.ts';
import { raceWithTimeout } from './raceWithTimeout.ts';

const end = new Date('2026-09-15T04:00:00-03:00');
const acceptedAt = new Date('2026-09-14T17:30:00-03:00');

describe('getCheckInTiming convocado', () => {
  const shift = {
    id: 'cov-1',
    origin: 'OPERATIONS_COVERAGE',
    startTime: new Date('2026-09-14T20:00:00-03:00'),
    endTime: end,
    createdAt: acceptedAt,
  };

  it('ficha desde la aceptación hasta el fin del hueco y no marca tarde', () => {
    const t = getCheckInTiming(shift as never, new Date('2026-09-14T21:30:00-03:00'));
    assert.equal(t.convocado, true);
    assert.equal(t.canCheckIn, true);
    assert.equal(t.canNotifyLate, false);
    assert.equal(t.lateNoNotice, false);
    assert.equal(t.lateMinutes, 0);
    assert.equal(t.checkInDeadline?.getTime(), end.getTime());
  });

  it('EXT no ficha', () => {
    const ext = getCheckInTiming(
      { ...shift, id: 'ext-1', coverageType: 'EXTEND' } as never,
      new Date('2026-09-14T18:00:00-03:00'),
    );
    assert.equal(ext.canCheckIn, false);
    assert.equal(ext.rejectCode, 'EXT_NO_CHECKIN');
  });

  it('antes de aceptar no ficha; después del fin tampoco', () => {
    const early = getCheckInTiming(shift as never, new Date('2026-09-14T17:00:00-03:00'));
    assert.equal(early.canCheckIn, false);
    assert.equal(early.tooEarly, true);
    const late = getCheckInTiming(shift as never, new Date('2026-09-15T04:05:00-03:00'));
    assert.equal(late.canCheckIn, false);
    assert.equal(late.rejectCode, 'SHIFT_ENDED');
  });

  it('el hero fichado del convocado no dice tarde', () => {
    const at = new Date(shift.startTime.getTime() + 40 * 60_000);
    const view = resolveCheckInUiStatus(
      { ...shift, isPresent: true, checkInAt: at, realStartTime: at } as never,
      null,
    );
    assert.equal(view.title.includes('tarde'), false);
    assert.match(view.title, /Ingresaste/);
  });

  it('listo para fichar: botón Marcar ingreso, sin tarde', () => {
    const timing = getCheckInTiming(shift as never, new Date('2026-09-14T21:30:00-03:00'));
    const view = resolveCheckInUiStatus(shift as never, timing);
    assert.equal(view.actionLabel, 'Marcar ingreso al llegar');
    assert.equal(`${view.title} ${view.subtitle || ''}`.includes('tarde'), false);
  });
});

describe('recordatorio convocado', () => {
  const sent = new Date('2026-09-14T20:20:00-03:00');

  it('hueco a más de 5 min: no pregunta ¿Seguís en camino? aunque haya recordatorio', () => {
    const sent = new Date('2026-10-07T10:30:00-03:00');
    const start = new Date('2026-10-07T10:45:00-03:00');
    const ahora = new Date('2026-10-07T10:31:00-03:00');
    const prev = Date.now;
    Date.now = () => ahora.getTime();
    try {
      assert.equal(isRecordatorioPendiente({
        status: 'ACCEPTED',
        type: 'REF',
        reminderSentAt: sent,
        startTime: start,
      }), false);
    } finally {
      Date.now = prev;
    }
  });

  it('pendiente = ACCEPTED + reminderSentAt + sin respuesta posterior + sin fichar', () => {
    assert.equal(isRecordatorioPendiente({ status: 'ACCEPTED', type: 'RET', reminderSentAt: sent }), true);
    assert.equal(isRecordatorioPendiente({ status: 'ACCEPTED', type: 'RET', reminderSentAt: sent }, true), false);
    assert.equal(isRecordatorioPendiente({ status: 'ACCEPTED', type: 'RET', reminderAt: sent }), false);
    assert.equal(isRecordatorioPendiente({ status: 'PENDING', reminderSentAt: sent }), false);
    assert.equal(isRecordatorioPendiente({ status: 'ACCEPTED', type: 'EXTEND', reminderSentAt: sent }), false);
  });

  it('convocadoReplyAt >= reminderSentAt ya respondió; una respuesta vieja no cuenta', () => {
    const later = new Date(sent.getTime() + 60_000);
    const earlier = new Date(sent.getTime() - 60_000);
    assert.equal(
      isRecordatorioPendiente({
        status: 'ACCEPTED',
        reminderSentAt: sent,
        convocadoReply: 'ON_WAY',
        convocadoReplyAt: later,
      }),
      false,
    );
    assert.equal(
      isRecordatorioPendiente({
        status: 'ACCEPTED',
        reminderSentAt: sent,
        convocadoReply: 'PROBLEM',
        convocadoReplyAt: sent,
      }),
      false,
    );
    assert.equal(
      isRecordatorioPendiente({ status: 'ACCEPTED', reminderSentAt: sent, convocadoReplyAt: earlier }),
      true,
    );
  });

  it('expectedArrivalAt manda; sin él, etaMinutes desde la aceptación', () => {
    const expected = new Date('2026-09-14T20:45:00-03:00');
    const accepted = new Date('2026-09-14T20:00:00-03:00');
    assert.equal(
      resolveExpectedArrivalAt({ expectedArrivalAt: expected, etaMinutes: 10, nowMs: Date.now() })?.getTime(),
      expected.getTime(),
    );
    assert.equal(
      resolveExpectedArrivalAt({ etaMinutes: 15, anchorMs: accepted.getTime(), nowMs: Date.now() })?.getTime(),
      accepted.getTime() + 15 * 60_000,
    );
    assert.equal(resolveExpectedArrivalAt({ nowMs: Date.now() }), null);
  });

  it('el push abre la ruta del banner con la convocatoria', () => {
    const parsed = parseConvocadoRecordatorioPush({
      type: 'CONVOCADO_RECORDATORIO',
      convocatoriaId: 'abc',
      etaMinutes: '15',
    });
    assert.deepEqual(parsed, { convocatoriaId: 'abc', etaMinutes: 15 });
    assert.equal(
      convocadoRecordatorioRoute(parsed!),
      '/(tabs)?focus=recordatorio&convocatoriaId=abc&etaMinutes=15',
    );
  });

  it('EN CAMINO nombra el objetivo y la hora estimada', () => {
    const eta = new Date('2026-09-14T21:15:00-03:00');
    const line = formatEnCaminoLine('Planta Norte', eta);
    assert.equal(line, `EN CAMINO a Planta Norte · llegada estimada ${formatTimeAr(eta)}`);
    assert.equal(line.includes('tarde'), false);
  });

  it('hueco futuro: próximo turno hasta salir, fichada desde T−15, llegada al inicio', () => {
    const accepted = new Date('2026-10-05T13:56:00-03:00');
    const gap = new Date('2026-10-05T16:00:00-03:00');
    const end = new Date('2026-10-05T17:00:00-03:00');
    const plan = planConvocadoArrival({
      acceptedAtMs: accepted.getTime(),
      gapStartMs: gap.getTime(),
      etaMinutes: 10,
    });
    assert.equal(plan.future, true);
    assert.equal(plan.expectedArrivalMs, gap.getTime());
    assert.equal(plan.departAtMs, new Date('2026-10-05T15:50:00-03:00').getTime());
    assert.equal(plan.punchOpenMs, new Date('2026-10-05T15:45:00-03:00').getTime());
    assert.equal(plan.reminderAtMs, new Date('2026-10-05T15:40:00-03:00').getTime());

    const shift = {
      id: 'fut',
      origin: 'OPERATIONS_COVERAGE',
      coverageType: 'FT',
      startTime: gap,
      endTime: end,
      acceptedAt: accepted,
      etaMinutes: 10,
      expectedArrivalAt: new Date(plan.expectedArrivalMs),
      objectiveName: 'Peaje 9 Norte',
      positionName: 'Puesto 1',
    };
    const early = getCheckInTiming(shift as never, new Date('2026-10-05T14:00:00-03:00'));
    assert.equal(early.convocadoPhase, 'proximo');
    assert.equal(early.canCheckIn, false);
    const at1550 = getCheckInTiming(shift as never, new Date('2026-10-05T15:50:00-03:00'));
    assert.equal(at1550.canCheckIn, true);
    assert.equal(at1550.convocadoPhase, 'en_camino');
    const ui = resolveCheckInUiStatus(shift as never, early);
    assert.equal(ui.title, 'Cobertura aceptada');
    assert.equal(ui.actionLabel, undefined);
    const line = coberturaAceptadaLine({
      gapStart: gap,
      gapEnd: end,
      now: accepted,
      objectiveName: 'Peaje 9 Norte',
      positionName: 'Puesto 1',
    });
    assert.equal(line, 'Cobertura aceptada · hoy 16:00–17:00 · Peaje 9 Norte · Puesto 1');
  });

  it('hueco ya empezado: llegada = aceptación + viaje y fichada desde la aceptación', () => {
    const accepted = new Date('2026-10-05T16:10:00-03:00');
    const gap = new Date('2026-10-05T16:00:00-03:00');
    const plan = planConvocadoArrival({
      acceptedAtMs: accepted.getTime(),
      gapStartMs: gap.getTime(),
      etaMinutes: 10,
    });
    assert.equal(plan.future, false);
    assert.equal(plan.expectedArrivalMs, accepted.getTime() + 10 * 60_000);
    assert.equal(plan.punchOpenMs, accepted.getTime());
    const shift = {
      id: 'ya',
      origin: 'OPERATIONS_COVERAGE',
      startTime: gap,
      endTime: new Date('2026-10-05T17:00:00-03:00'),
      acceptedAt: accepted,
      etaMinutes: 10,
    };
    const t = getCheckInTiming(shift as never, new Date('2026-10-05T16:12:00-03:00'));
    assert.equal(t.canCheckIn, true);
    assert.equal(t.convocadoPhase, 'en_camino');
  });
});

describe('EXT y ADV', () => {
  it('EXT presente: Extendido hasta HH:MM y sin acción de fichar', () => {
    const until = new Date('2026-09-14T22:00:00-03:00');
    const shift = {
      id: 'ext',
      origin: 'PLANIFICADOR',
      isExtended: true,
      isPresent: true,
      startTime: new Date('2026-09-14T14:00:00-03:00'),
      endTime: until,
      checkInAt: new Date('2026-09-14T13:50:00-03:00'),
    };
    assert.equal(extendUntilLine(shift), `Extendido hasta ${formatTimeAr(until)}`);
    const view = resolveCheckInUiStatus(shift as never, null);
    assert.equal(view.title, `Extendido hasta ${formatTimeAr(until)}`);
    assert.equal(view.actionLabel, undefined);
  });

  it('ADV muestra el inicio adelantado', () => {
    const shift = {
      id: 'adv',
      origin: 'PLANIFICADOR',
      isEarlyStart: true,
      adjustedStartTime: '18:00',
      startTime: new Date('2026-09-14T20:00:00-03:00'),
      endTime: new Date('2026-09-15T04:00:00-03:00'),
    };
    assert.equal(advanceStartLine(shift), 'Inicio adelantado 18:00');
    const view = resolveCheckInUiStatus(shift as never, {
      diffMinutes: 0,
      canCheckIn: true,
      canNotifyLate: false,
      lateWindow: false,
      tooEarly: false,
    });
    assert.equal(view.title, 'Inicio adelantado 18:00');
    assert.equal(view.actionLabel, undefined);
  });
});

describe('originCoords timeout', () => {
  it('si el GPS no responde en el plazo, sigue sin coordenadas', async () => {
    const hung = new Promise<string>(() => {});
    const value = await raceWithTimeout(hung, 20);
    assert.equal(value, null);
  });
});
