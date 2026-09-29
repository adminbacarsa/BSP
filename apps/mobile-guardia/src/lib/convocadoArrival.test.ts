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
  extendUntilLine,
  formatEnCaminoLine,
  isRecordatorioPendiente,
  parseConvocadoRecordatorioPush,
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
  it('pendiente solo si aceptó, no fichó y el recordatorio sigue abierto', () => {
    assert.equal(
      isRecordatorioPendiente({ status: 'ACCEPTED', recordatorioPendiente: true, type: 'RET' }),
      true,
    );
    assert.equal(
      isRecordatorioPendiente({ status: 'ACCEPTED', recordatorioPendiente: true }, true),
      false,
    );
    assert.equal(
      isRecordatorioPendiente({ status: 'ACCEPTED', recordatorioStatus: 'ON_WAY', recordatorioPendiente: true }),
      false,
    );
    assert.equal(isRecordatorioPendiente({ status: 'PENDING', recordatorioPendiente: true }), false);
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
