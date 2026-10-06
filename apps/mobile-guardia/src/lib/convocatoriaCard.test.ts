/**
 * Tests — modelo único de la tarjeta de convocatoria (Hoy y Alertas).
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/convocatoriaCard.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import {
  armarPreguntaDisponibilidad,
  buildCoberturaCardModel,
  buildDisponibilidadCardModel,
  buildEventoCardModel,
  buildInboxCardModel,
  buildRetencionCardModel,
  buildVenisCardModel,
  convocatoriaFirstName,
  convocatoriaTipoLabel,
  formatFechaAr,
  formatHorario24,
  remainingLabel,
  resolveLugarConvocatoria,
} from './convocatoriaCard';

// 05/10/2026 16:00–17:00 hora AR (UTC-3)
const START = '2026-10-05T16:00:00-03:00';
const END = '2026-10-05T17:00:00-03:00';

const peaje: ObjectiveLocation = { lat: -31.3, lng: -64.2, name: 'Peaje 9 Norte', clientName: 'Caminos de las Sierras' };
const objectivesMap: Record<string, ObjectiveLocation> = { 'obj-peaje': peaje };

const convFt = {
  id: 'conv-1',
  type: 'FT',
  status: 'PENDING',
  shiftId: 'turno-titular',
  objectiveId: 'obj-peaje',
  positionName: 'Puesto 1',
  shiftCode: 'T3',
  startTime: START,
  endTime: END,
  timeoutAt: '2026-10-05T15:59:59-03:00',
  candidateEmployeeName: 'SANCHEZ Laura Romina',
};

describe('formato de hora y fecha', () => {
  it('horario siempre en 24 h: 16:00–17:00 (nunca «05:00 p. m.»)', () => {
    assert.equal(formatHorario24(START, END), '16:00–17:00');
    assert.equal(formatHorario24(START), '16:00');
    assert.equal(formatHorario24('2026-10-05T23:30:00-03:00', '2026-10-06T07:00:00-03:00'), '23:30–07:00');
    assert.equal(formatHorario24(null), null);
    assert.doesNotMatch(formatHorario24(START, END) ?? '', /p\.\s?m\.|a\.\s?m\./i);
  });

  it('acepta Timestamp-like y Date', () => {
    const ts = { seconds: Math.floor(new Date(START).getTime() / 1000) };
    assert.equal(formatHorario24(ts, new Date(END)), '16:00–17:00');
  });

  it('fecha dd/MM/yyyy en hora AR', () => {
    assert.equal(formatFechaAr(START), '05/10/2026');
    // 23:30 del 05/10 en UTC ya es 06/10: la fecha es la de Argentina.
    assert.equal(formatFechaAr('2026-10-05T23:30:00-03:00'), '05/10/2026');
  });
});

describe('tipo en palabras', () => {
  it('cubre la cascada CCT', () => {
    assert.equal(convocatoriaTipoLabel('FT'), 'Franco trabajado (FT)');
    assert.equal(convocatoriaTipoLabel('EXTEND'), 'Extensión');
    assert.equal(convocatoriaTipoLabel('EXT'), 'Extensión');
    assert.equal(convocatoriaTipoLabel('ADVANCE'), 'Adelanto');
    assert.equal(convocatoriaTipoLabel('RET'), 'Retén');
    assert.equal(convocatoriaTipoLabel('REF'), 'Refuerzo');
    assert.equal(convocatoriaTipoLabel('ESC'), 'Escuela');
    assert.equal(convocatoriaTipoLabel('EVENTUAL'), 'Eventual');
    assert.equal(convocatoriaTipoLabel('EVENTO'), 'Evento');
    assert.equal(convocatoriaTipoLabel('SIN_TURNO'), 'Cobertura');
    assert.equal(convocatoriaTipoLabel(undefined), 'Cobertura');
  });
});

describe('primer nombre', () => {
  it('prefiere firstName del legajo; si no, lo que sigue a la coma; si no, el primer token', () => {
    assert.equal(convocatoriaFirstName({ firstName: 'Laura Romina' }), 'Laura');
    assert.equal(convocatoriaFirstName({ fullName: 'SANCHEZ, Laura Romina' }), 'Laura');
    assert.equal(convocatoriaFirstName({ fullName: 'SANCHEZ Laura Romina' }), 'Sanchez');
    assert.equal(convocatoriaFirstName({}), '');
  });
});

describe('objetivo real (nunca el literal «Objetivo»)', () => {
  it('sin objectiveName en la convocatoria lo resuelve del mapa de objetivos por objectiveId', () => {
    const lugar = resolveLugarConvocatoria(convFt, [], objectivesMap);
    assert.equal(lugar.objetivo, 'Peaje 9 Norte');
    assert.equal(lugar.cliente, 'Caminos de las Sierras');
    assert.equal(lugar.puesto, 'Puesto 1');
  });

  it('lo resuelve del turno (shiftId) cuando la convocatoria no trae objectiveId', () => {
    const shifts: Shift[] = [
      { id: 'turno-titular', objectiveId: 'obj-peaje', objectiveName: 'Peaje 9 Norte', clientName: 'Caminos', positionName: 'Puesto 2' },
    ];
    const lugar = resolveLugarConvocatoria({ shiftId: 'turno-titular' }, shifts, {});
    assert.equal(lugar.objetivo, 'Peaje 9 Norte');
    assert.equal(lugar.cliente, 'Caminos');
    assert.equal(lugar.puesto, 'Puesto 2');
  });

  it('descarta placeholders («Objetivo», «tu puesto») y deja null si no hay dato', () => {
    const lugar = resolveLugarConvocatoria({ objectiveName: 'Objetivo', positionName: 'tu puesto' }, [], {});
    assert.equal(lugar.objetivo, null);
    assert.equal(lugar.puesto, null);
  });
});

describe('buildCoberturaCardModel', () => {
  it('FT Puesto 1 16:00–17:00 T3 en Peaje 9 Norte con mensaje personalizado', () => {
    const m = buildCoberturaCardModel({ conv: convFt, firstName: 'Laura', objectivesMap });
    assert.equal(m.kind, 'COBERTURA');
    assert.equal(m.title, '¿Nos das una mano?');
    assert.equal(m.tipo, 'Franco trabajado (FT)');
    assert.equal(m.objetivo, 'Peaje 9 Norte');
    assert.equal(m.cliente, 'Caminos de las Sierras');
    assert.equal(m.puesto, 'Puesto 1');
    assert.equal(m.fecha, '05/10/2026');
    assert.equal(m.horario, '16:00–17:00');
    assert.equal(m.codigo, 'T3');
    assert.equal(m.actions, 'ACCEPT_REJECT');
    assert.equal(m.message, 'Laura, ¿nos das una mano? Necesitamos cubrir Puesto 1 en Peaje 9 Norte de 16:00 a 17:00.');
    assert.ok(m.timeoutAtMs && m.timeoutAtMs > 0);
    assert.doesNotMatch(JSON.stringify(m), /"Objetivo"|p\. m\./);
  });

  it('sin firstName usa el nombre de la convocatoria; sin nada arranca con mayúscula', () => {
    const m = buildCoberturaCardModel({ conv: convFt, objectivesMap });
    assert.match(m.message, /^Sanchez, ¿nos das una mano\?/);
    const sin = buildCoberturaCardModel({ conv: { ...convFt, candidateEmployeeName: undefined }, objectivesMap });
    assert.match(sin.message, /^¿Nos das una mano\? Necesitamos cubrir Puesto 1 en Peaje 9 Norte de 16:00 a 17:00\.$/);
  });
});

describe('buildVenisCardModel', () => {
  it('¿Venís? con 10/15/30 y texto del servidor si vino', () => {
    const m = buildVenisCardModel({
      conv: { ...convFt, type: 'LLEGADA_TARDE', timeoutAt: undefined },
      firstName: 'Laura',
      objectivesMap,
      body: 'Laura, te esperan en Peaje 9 Norte · Puesto 1, ¿venís?',
    });
    assert.equal(m.kind, 'VENIS');
    assert.equal(m.title, '¿Venís?');
    assert.equal(m.actions, 'VENIS');
    assert.equal(m.message, 'Laura, te esperan en Peaje 9 Norte · Puesto 1, ¿venís?');
    assert.equal(m.objetivo, 'Peaje 9 Norte');
    assert.equal(m.horario, '16:00–17:00');
  });

  it('sin body arma el texto propio con la hora en 24 h', () => {
    const m = buildVenisCardModel({ conv: { ...convFt, type: 'LLEGADA_TARDE' }, firstName: 'Laura', objectivesMap });
    assert.equal(m.message, 'Laura, ¿venís? Tu turno empezó a las 16:00 en Peaje 9 Norte · Puesto 1. Contanos si llegás en 10, 15 o 30 min.');
  });
});

describe('buildEventoCardModel', () => {
  it('evento con servicio, fecha y horario del evento', () => {
    const m = buildEventoCardModel({
      sol: {
        id: 'sol-1',
        empresaId: 'e1',
        eventoId: 'ev-1',
        eventoNombre: 'Recital Plaza',
        servicioId: 'srv-1',
        servicioNombre: 'Control de acceso',
        servicioFecha: '2026-10-12',
        empleadoId: 'emp-1',
        empleadoNombre: 'SANCHEZ, Laura',
        tipo: 'admin_convoca',
        status: 'convocado',
      },
      firstName: 'Laura',
      eventosMap: {
        'ev-1': {
          id: 'ev-1',
          empresaId: 'e1',
          nombre: 'Recital Plaza',
          clienteId: 'c1',
          clienteNombre: 'Municipalidad',
          fecha: '2026-10-12',
          status: 'publicado' as never,
          servicios: [
            {
              id: 'srv-1',
              nombre: 'Control de acceso',
              fecha: '2026-10-12',
              tipoTurno: 'EV' as never,
              horaInicio: '18:00',
              horaFin: '02:00',
              horasTotal: 8,
              ubicacion: { tipo: 'nueva', direccion: 'Plaza San Martín' },
              cupo: 4,
              status: 'abierto' as never,
            },
          ],
        },
      },
    });
    assert.equal(m.kind, 'EVENTO');
    assert.equal(m.tipo, 'Evento');
    assert.equal(m.title, 'Recital Plaza');
    assert.equal(m.cliente, 'Municipalidad');
    assert.equal(m.objetivo, 'Plaza San Martín');
    assert.equal(m.puesto, 'Control de acceso');
    assert.equal(m.fecha, '12/10/2026');
    assert.equal(m.horario, '18:00–02:00');
    assert.equal(m.actions, 'ACCEPT_REJECT');
    assert.match(m.message, /^Laura, te convocamos al evento Recital Plaza \(Control de acceso\) el 12\/10\/2026 de 18:00 a 02:00\.$/);
  });
});

describe('buildRetencionCardModel', () => {
  it('informativa, sin botones, con el lugar del turno', () => {
    const m = buildRetencionCardModel({
      aviso: { id: 'n-1', title: 'Seguís retenido', body: 'Laura, seguís retenida. Tu relevo PEREZ llega ~17:20.', shiftId: 'turno-1' },
      shifts: [{ id: 'turno-1', objectiveName: 'Peaje 9 Norte', clientName: 'Caminos', positionName: 'Puesto 1', startTime: START, endTime: END }],
    });
    assert.equal(m.kind, 'RETENCION');
    assert.equal(m.tipo, 'Retén');
    assert.equal(m.actions, 'NONE');
    assert.equal(m.objetivo, 'Peaje 9 Norte');
    assert.equal(m.horario, '16:00–17:00');
    assert.match(m.message, /relevo PEREZ/);
  });
});

describe('buildInboxCardModel (Alertas)', () => {
  it('CONVOCATORIA_COBERTURA completa el lugar con el doc de la convocatoria y arma la misma tarjeta que Hoy', () => {
    const hoy = buildCoberturaCardModel({ conv: convFt, firstName: 'Laura', objectivesMap });
    const alerta = buildInboxCardModel({
      item: {
        id: 'notif-1',
        type: 'CONVOCATORIA_COBERTURA',
        title: '¿Nos das una mano?',
        body: 'Sanchez, ¿nos das una mano? Necesitamos cubrir Puesto 1 de 16:00 a 05:00 p. m.',
        convocatoriaId: 'conv-1',
        positionName: 'Puesto 1',
        shiftCode: 'T3',
        startTime: START,
        endTime: END,
      },
      conv: { ...convFt, type: 'FT', status: 'PENDING' },
      firstName: 'Laura',
      objectivesMap,
    });
    assert.ok(alerta);
    assert.equal(alerta.id, 'notif-1');
    assert.equal(alerta.title, hoy.title);
    assert.equal(alerta.message, hoy.message);
    assert.equal(alerta.objetivo, 'Peaje 9 Norte');
    assert.equal(alerta.horario, '16:00–17:00');
    assert.equal(alerta.tipo, 'Franco trabajado (FT)');
    assert.doesNotMatch(alerta.message, /p\. m\./);
  });

  it('título «¿Venís?» o conv LLEGADA_TARDE → tarjeta VENIS', () => {
    const m = buildInboxCardModel({
      item: { id: 'n-2', type: 'CONVOCATORIA_COBERTURA', title: '¿Venís?', body: 'Laura, ¿venís? Tu turno empezó a las 16:00.', convocatoriaId: 'c-2' },
      conv: { type: 'LLEGADA_TARDE', status: 'PENDING', objectiveName: 'Peaje 9 Norte' },
    });
    assert.equal(m?.kind, 'VENIS');
    assert.equal(m?.actions, 'VENIS');
    assert.equal(m?.objetivo, 'Peaje 9 Norte');
  });

  it('RETENCION_AVISO → informativa; CONVOCATORIA_EVENTO → evento sin botones; otros → null', () => {
    assert.equal(buildInboxCardModel({ item: { id: 'r', type: 'RETENCION_AVISO', title: 'Seguís retenido', body: 'x' } })?.kind, 'RETENCION');
    const ev = buildInboxCardModel({ item: { id: 'e', type: 'CONVOCATORIA_EVENTO', title: 'Recital Plaza', body: 'Te convocamos' } });
    assert.equal(ev?.kind, 'EVENTO');
    assert.equal(ev?.actions, 'NONE');
    assert.equal(buildInboxCardModel({ item: { id: 'p', type: 'CRONOGRAMA_PUBLICADO' } }), null);
  });
});

describe('consulta de disponibilidad en bloque', () => {
  it('pregunta por los N días, lista cada jornada y avisa si son dos contratos', () => {
    const uno = armarPreguntaDisponibilidad({
      objetivo: 'Peaje',
      jornadas: [{ fecha: '2026-10-06', code: 'M', horaInicio: '07:00', horaFin: '15:00' }],
    });
    assert.equal(uno, null);
    const bloque = armarPreguntaDisponibilidad({
      objetivo: 'Peaje 9 Norte',
      puesto: 'Puesto 1',
      jornadas: [
        { fecha: '2026-10-15', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
        { fecha: '2026-10-06', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
      ],
    });
    assert.equal(bloque?.pregunta, '¿Podés cubrir 2 días (06/10 → 15/10) en Peaje 9 Norte · Puesto 1?');
    assert.deepEqual(bloque?.detalle, ['06/10 · M 07:00–15:00', '15/10 · M 07:00–15:00']);
    assert.equal(bloque?.contratos, null);
    const cruza = armarPreguntaDisponibilidad({
      objetivo: 'Peaje',
      jornadas: [
        { fecha: '2026-10-28', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
        { fecha: '2026-11-03', code: 'T', horaInicio: '15:00', horaFin: '23:00' },
      ],
    });
    assert.match(cruza?.contratos || '', /Son dos contratos \(octubre 2026 y noviembre 2026\)/);
    const model = buildDisponibilidadCardModel({
      id: 'c1',
      title: '¿Podés cubrir?',
      message: `${bloque?.pregunta}`,
      detalle: bloque?.detalle,
    });
    assert.equal(model.kind, 'DISPONIBILIDAD');
    assert.equal(model.title, '¿Podés cubrir?');
    assert.deepEqual(model.detalle, ['06/10 · M 07:00–15:00', '15/10 · M 07:00–15:00']);
    assert.equal(model.acceptLabel, 'Sí, puedo');
  });
});

describe('cuenta regresiva', () => {
  it('segundos, minutos y agotado', () => {
    const t = new Date('2026-10-05T16:00:00-03:00').getTime();
    assert.equal(remainingLabel(t, t - 59_000), '59s restantes');
    assert.equal(remainingLabel(t, t - 150_000), '2:30 restantes');
    assert.equal(remainingLabel(t, t + 1), 'Tiempo agotado (aún podés responder)');
    assert.equal(remainingLabel(null, t), '');
  });
});
