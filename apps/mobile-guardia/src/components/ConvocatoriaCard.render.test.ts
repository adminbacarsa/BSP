/**
 * Render de la tarjeta única de convocatoria (react-dom/server con stubs de RN).
 * node --import ./src/lib/testing/rn-render-register.mjs --experimental-strip-types --test src/components/ConvocatoriaCard.render.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectiveLocation } from '@cosp/portal-types';
import { ThemeProvider } from '../theme/ThemeContext';
import { ConvocatoriaCard } from './ConvocatoriaCard';
import {
  armarPreguntaDisponibilidad,
  buildCoberturaCardModel,
  buildDisponibilidadCardModel,
  buildEventoCardModel,
  buildRetencionCardModel,
  buildVenisCardModel,
  type ConvocatoriaCardModel,
} from '../lib/convocatoriaCard';

const START = '2026-10-05T16:00:00-03:00';
const END = '2026-10-05T17:00:00-03:00';
const NOW = new Date('2026-10-05T15:59:01-03:00').getTime();
const objectivesMap: Record<string, ObjectiveLocation> = {
  'obj-peaje': { lat: -31.3, lng: -64.2, name: 'Peaje 9 Norte', clientName: 'Caminos de las Sierras' },
};

function render(model: ConvocatoriaCardModel, props: Record<string, unknown> = {}): string {
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      null,
      createElement(ConvocatoriaCard, {
        model,
        nowMs: NOW,
        onAccept: () => {},
        onReject: () => {},
        onSiVoy: () => {},
        onNoVoy: () => {},
        ...props,
      }),
    ),
  );
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buttons(html: string): string[] {
  return Array.from(html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)).map((m) => m[1]);
}

const convFt = {
  id: 'conv-1',
  type: 'FT',
  status: 'PENDING',
  objectiveId: 'obj-peaje',
  positionName: 'Puesto 1',
  shiftCode: 'T3',
  startTime: START,
  endTime: END,
  timeoutAt: '2026-10-05T16:00:00-03:00',
  candidateEmployeeName: 'SANCHEZ Laura Romina',
};

describe('ConvocatoriaCard · cobertura', () => {
  it('FT: título, tipo en palabras, objetivo real, puesto, fecha, 24 h, cuenta regresiva y Aceptar/Rechazar', () => {
    const html = render(buildCoberturaCardModel({ conv: convFt, firstName: 'Laura', objectivesMap }));
    const t = text(html);
    assert.match(t, /¿Nos das una mano\?/);
    assert.match(t, /Franco trabajado \(FT\)/);
    assert.match(t, /Caminos de las Sierras · Peaje 9 Norte/);
    assert.match(t, /Puesto 1/);
    assert.match(t, /05\/10\/2026 · 16:00–17:00/);
    assert.match(t, /Código T3/);
    assert.match(t, /59s restantes/);
    assert.match(t, /Laura, ¿nos das una mano\? Necesitamos cubrir Puesto 1 en Peaje 9 Norte de 16:00 a 17:00\./);
    assert.deepEqual(buttons(html), ['Aceptar', 'Rechazar']);
    assert.doesNotMatch(t, /\bObjetivo\b(?! Revisión)/);
    assert.doesNotMatch(t, /p\. m\.|a\. m\./);
    assert.doesNotMatch(t, /Acepto|No puedo/);
  });

  it('objetivo faltante en la convocatoria: lo resuelve del turno titular', () => {
    const html = render(
      buildCoberturaCardModel({
        conv: { ...convFt, objectiveId: undefined, shiftId: 'turno-titular', type: 'EXTEND' },
        firstName: 'Laura',
        shifts: [{ id: 'turno-titular', objectiveName: 'Peaje 9 Norte', clientName: 'Caminos', positionName: 'Puesto 1' }],
      }),
    );
    const t = text(html);
    assert.match(t, /Extensión/);
    assert.match(t, /Caminos · Peaje 9 Norte/);
    assert.doesNotMatch(t, /\bObjetivo\b/);
  });

  it('cerrada: muestra el estado y no los botones', () => {
    const html = render(buildCoberturaCardModel({ conv: convFt, objectivesMap }), { closedLabel: 'Vencida' });
    assert.deepEqual(buttons(html), []);
    assert.match(text(html), /Vencida/);
    assert.doesNotMatch(text(html), /restantes/);
  });

  it('busy: los dos botones quedan deshabilitados', () => {
    const html = render(buildCoberturaCardModel({ conv: convFt, objectivesMap }), { busy: true });
    const disabled = Array.from(html.matchAll(/<button[^>]*disabled=""/g)).length;
    assert.equal(disabled, 2);
  });

  it('cada tipo de la cascada se muestra en palabras', () => {
    const esperado: Record<string, RegExp> = {
      RET: /Retén/,
      REF: /Refuerzo/,
      ESC: /Escuela/,
      ADVANCE: /Adelanto/,
      EVENTUAL: /Eventual/,
      SIN_TURNO: /Cobertura/,
    };
    for (const [type, re] of Object.entries(esperado)) {
      const t = text(render(buildCoberturaCardModel({ conv: { ...convFt, type }, objectivesMap })));
      assert.match(t, re, type);
    }
  });
});

describe('ConvocatoriaCard · ¿Venís?', () => {
  it('10 / 15 / 30 min y «Tengo un problema», sin Aceptar/Rechazar', () => {
    const html = render(
      buildVenisCardModel({ conv: { ...convFt, type: 'LLEGADA_TARDE', timeoutAt: undefined }, firstName: 'Laura', objectivesMap }),
    );
    const t = text(html);
    assert.match(t, /¿Venís\?/);
    assert.match(t, /Laura, ¿venís\? Tu turno empezó a las 16:00 en Peaje 9 Norte · Puesto 1\./);
    assert.match(t, /Llegada tarde/i);
    assert.deepEqual(buttons(html), ['10 min', '15 min', '30 min', 'Tengo un problema']);
  });
});

describe('ConvocatoriaCard · evento', () => {
  it('evento con fecha y horario, Aceptar/Rechazar', () => {
    const html = render(
      buildEventoCardModel({
        sol: {
          id: 's1',
          empresaId: 'e1',
          eventoId: 'ev-1',
          eventoNombre: 'Recital Plaza',
          servicioId: 'srv-1',
          servicioNombre: 'Control de acceso',
          servicioFecha: '2026-10-12',
          empleadoId: 'emp',
          empleadoNombre: 'SANCHEZ, Laura',
          tipo: 'admin_convoca',
          status: 'convocado',
          jornada: { fecha: '2026-10-12', horaInicio: '18:00', horaFin: '02:00' },
        },
        firstName: 'Laura',
      }),
    );
    const t = text(html);
    assert.match(t, /Recital Plaza/);
    assert.match(t, /Evento/);
    assert.match(t, /Control de acceso/);
    assert.match(t, /12\/10\/2026 · 18:00–02:00/);
    assert.deepEqual(buttons(html), ['Aceptar', 'Rechazar']);
  });
});

describe('ConvocatoriaCard · disponibilidad en bloque', () => {
  it('pregunta por los N días y lista cada jornada', () => {
    const bloque = armarPreguntaDisponibilidad({
      objetivo: 'Peaje 9 Norte',
      puesto: 'Puesto 1',
      jornadas: [
        { fecha: '2026-10-06', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
        { fecha: '2026-10-15', code: 'M', horaInicio: '07:00', horaFin: '15:00' },
      ],
    });
    const html = render(buildDisponibilidadCardModel({
      id: 'consulta-1',
      title: '¿Podés cubrir?',
      message: bloque?.pregunta || '',
      detalle: bloque?.detalle,
      objetivo: 'Peaje 9 Norte',
      puesto: 'Puesto 1',
    }));
    const t = text(html);
    assert.match(t, /¿Podés cubrir 2 días \(06\/10 → 15\/10\) en Peaje 9 Norte · Puesto 1\?/);
    assert.match(t, /06\/10 · M 07:00–15:00/);
    assert.match(t, /15\/10 · M 07:00–15:00/);
    assert.deepEqual(buttons(html), ['Sí, puedo', 'No puedo']);
  });
});

describe('ConvocatoriaCard · retención', () => {
  it('informativa: sin botones, con el texto del CC', () => {
    const html = render(
      buildRetencionCardModel({
        aviso: { id: 'n1', title: 'Seguís retenido', body: 'Laura, seguís retenida. Tu relevo PEREZ llega ~17:20.', shiftId: 't1' },
        shifts: [{ id: 't1', objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1', startTime: START, endTime: END }],
      }),
    );
    const t = text(html);
    assert.match(t, /Retención/i);
    assert.match(t, /Seguís retenido/);
    assert.match(t, /relevo PEREZ/);
    assert.match(t, /Peaje 9 Norte/);
    assert.match(t, /16:00–17:00/);
    assert.deepEqual(buttons(html), []);
  });

  it('extraActions (Alertas): Quitar debajo', () => {
    const model = buildRetencionCardModel({ aviso: { id: 'n1', body: 'x' } });
    const html = render(model, {
      metaLine: 'Recibida 05/10/2026 15:58',
      extraActions: createElement('button', { 'aria-label': 'Quitar' }, 'Quitar'),
    });
    assert.match(text(html), /Recibida 05\/10\/2026 15:58/);
    assert.deepEqual(buttons(html), ['Quitar']);
  });
});
