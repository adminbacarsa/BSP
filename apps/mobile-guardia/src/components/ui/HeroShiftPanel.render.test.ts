/**
 * Render de HeroShiftPanel (tarjeta Turno actual legible).
 * node --import ./src/lib/testing/rn-render-register.mjs --experimental-strip-types --test src/components/ui/HeroShiftPanel.render.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '../../theme/ThemeContext';
import { HeroShiftPanel } from './HeroShiftPanel';
import type { HeroEvDisplay } from '../../lib/heroShiftCard';
import type { ShiftPlacement } from '../../lib/shiftPlacement';

const peaje: ShiftPlacement = {
  client: 'Caminos',
  objective: 'Plaza de la Musica',
  position: 'general',
  line: 'Caminos · Plaza de la Musica · general',
  objectiveLocation: {
    lat: -31.4,
    lng: -64.2,
    name: 'Plaza de la Musica',
    address: 'Plaza de La Musica',
  },
};

const ev: HeroEvDisplay = {
  nombre: 'general',
  eventoNombre: 'evento plaza',
  clienteNombre: 'Caminos',
  horarioBadge: '12:00–20:00',
  direccion: 'Plaza de La Musica',
  mapsUrl: 'https://maps.example/plaza',
  requisitos: 'test',
  instrucciones: null,
};

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, null, createElement(HeroShiftPanel, props as never)),
  )
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('HeroShiftPanel · evento (rojo Pruebas)', () => {
  it('horario grande, una línea de evento, lugar una vez, Nota; sin chips duplicados ni Cómo llegar en el cuerpo', () => {
    const html = render({
      sectionLabel: 'Turno actual',
      isToday: true,
      timeRange: '12:00–20:00',
      placement: peaje,
      ev,
      mapsUrl: ev.mapsUrl,
      accentColor: '#D32F2F',
      statusSlot: createElement('span', null, 'Ingresaste 12:12 (12 min tarde)'),
      footer: createElement('button', null, 'Cómo llegar'),
    });
    const t = text(html);
    assert.match(t, /TURNO ACTUAL · HOY/);
    assert.match(t, /12:00–20:00/);
    assert.match(t, /Evento: evento plaza · servicio general/);
    assert.match(t, /Plaza de La Musica/);
    assert.match(t, /Nota: test/);
    assert.match(t, /Ingresaste 12:12/);
    // Un solo Cómo llegar (el del footer; el cuerpo no tiene link).
    assert.equal((t.match(/Cómo llegar/g) || []).length, 1);
    // No chips del hero viejo ni texto rojo-sobre-rojo de EvShiftDetails.
    assert.doesNotMatch(t, /EV · general/);
    // El lugar aparece una vez (wherePlace), no como chip + título + EvShiftDetails.
    const placeCount = (t.match(/Plaza de [Ll]a Musica/gi) || []).length;
    assert.equal(placeCount, 1);
  });
});

describe('HeroShiftPanel · puesto y retenido (accent claro)', () => {
  it('puesto con accent claro sigue legible (filete oscurecido)', () => {
    const html = render({
      sectionLabel: 'Turno actual',
      isToday: true,
      timeRange: '08:00–16:00',
      placement: {
        client: 'Cliente SA',
        objective: 'Peaje 9 Norte',
        position: 'Puesto 1',
        line: 'Cliente SA · Peaje 9 Norte · Puesto 1',
        objectiveLocation: null,
      },
      accentColor: '#F5D76E',
    });
    const t = text(html);
    assert.match(t, /TURNO ACTUAL · HOY/);
    assert.match(t, /08:00–16:00/);
    assert.match(t, /Cliente SA · Peaje 9 Norte/);
    assert.match(t, /Puesto 1/);
  });

  it('retenido: kicker y lugar sin duplicar Cómo llegar', () => {
    const html = render({
      sectionLabel: 'Retenido',
      isToday: true,
      timeRange: '15:00–23:00',
      placement: peaje,
      isRetention: true,
      accentColor: '#D32F2F',
    });
    const t = text(html);
    assert.match(t, /RETENIDO/);
    assert.doesNotMatch(t, /TURNO ACTUAL/);
    assert.match(t, /Caminos · Plaza de la Musica/);
    assert.match(html, /line-through|text-decoration/);
    assert.match(html, /#b91c1c/);
    assert.equal((html.match(/Cómo llegar/g) || []).length, 0);
  });

  it('retenido: horario tachado, contador, relevo, tope y Entendido en la misma tarjeta', () => {
    const html = render({
      sectionLabel: 'Turno actual',
      isToday: true,
      timeRange: '11:30–15:15',
      placement: {
        client: 'Caminos',
        objective: 'Peaje 9 Norte',
        position: 'Puesto 2',
        line: 'Caminos · Peaje 9 Norte · Puesto 2',
        objectiveLocation: null,
      },
      isRetention: true,
      accentColor: '#D32F2F',
      retencion: {
        lineaEstado: 'terminó 15:15 · retenido desde 15:15',
        hace: 'hace 12 min',
        espera: 'Esperando a BRIZUELA, llega ~15:45',
        tope: 'podés quedarte hasta 23:29',
      },
      onEntendido: () => {},
    });
    const t = text(html);
    assert.match(t, /^RETENIDO|RETENIDO/);
    assert.doesNotMatch(t, /TURNO ACTUAL/);
    assert.match(t, /11:30–15:15/);
    assert.match(html, /line-through|text-decoration/);
    assert.match(t, /terminó 15:15 · retenido desde 15:15/);
    assert.match(t, /hace 12 min/);
    assert.match(t, /Esperando a BRIZUELA, llega ~15:45/);
    assert.match(t, /podés quedarte hasta 23:29/);
    assert.match(t, /Entendido/);
    assert.match(t, /Peaje 9 Norte/);
    assert.match(html, /#b91c1c/);
    assert.equal((t.match(/Cómo llegar/g) || []).length, 0);
  });

  it('retenido sin relevo: sin relevo confirmado; con acuse no hay botón', () => {
    const html = render({
      sectionLabel: 'Turno actual',
      isToday: true,
      timeRange: '11:30–15:15',
      placement: peaje,
      isRetention: true,
      retencion: {
        lineaEstado: 'terminó 15:15 · retenido desde 15:00',
        hace: 'hace 12 min',
        espera: 'sin relevo confirmado',
        tope: 'podés quedarte hasta 00:29',
      },
      acuseAt: new Date('2026-10-07T15:08:00-03:00').getTime(),
      onEntendido: () => {},
    });
    const t = text(html);
    assert.match(t, /sin relevo confirmado/);
    assert.match(t, /Entendido · 15:08/);
    assert.equal((html.match(/<button/g) || []).length, 0);
  });

  it('convocatoria aceptada futura: EN CAMINO + cliente·objetivo', () => {
    const html = render({
      sectionLabel: 'Próximo turno',
      isToday: false,
      timeRange: '16:00–17:00',
      placement: peaje,
      isConvocado: true,
      accentColor: '#F5D76E',
      empresaLabel: 'Pruebas SA',
      footer: createElement('button', null, 'Cómo llegar'),
    });
    const t = text(html);
    assert.match(t, /EN CAMINO/);
    assert.match(t, /Pruebas SA/);
    assert.match(t, /16:00–17:00/);
    assert.match(t, /Caminos · Plaza de la Musica/);
    assert.equal((t.match(/Cómo llegar/g) || []).length, 1);
  });
});
