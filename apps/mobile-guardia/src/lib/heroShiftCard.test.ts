/**
 * Tests — tarjeta Turno actual legible (jerarquía, EV, accent AA).
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/heroShiftCard.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeroShiftCardModel,
  firmarAnexoDelTurno,
  resolveHeroAccentColor,
  HERO_FALLBACK_ACCENT,
  LABEL_FIRMAR_ANEXO,
} from './heroShiftCard';
import type { ShiftPlacement } from './shiftPlacement';

const peaje: ShiftPlacement = {
  client: 'Caminos',
  objective: 'Plaza de la Musica',
  position: 'general',
  line: 'Caminos · Plaza de la Musica · general',
  objectiveLocation: {
    lat: -31.4,
    lng: -64.2,
    name: 'Plaza de la Musica',
    clientName: 'Caminos',
    address: 'Plaza de La Musica',
  },
};

describe('resolveHeroAccentColor', () => {
  it('rojo Pruebas SA se mantiene (oscuro, buen contraste)', () => {
    assert.equal(resolveHeroAccentColor('#D32F2F'), '#D32F2F');
    assert.equal(resolveHeroAccentColor('#8B1A1A'), '#8B1A1A');
  });

  it('color claro → variante oscura (AA con blanco)', () => {
    const accent = resolveHeroAccentColor('#F5D76E');
    assert.notEqual(accent.toLowerCase(), '#f5d76e');
    assert.match(accent, /^#[0-9a-f]{6}$/i);
    // Luminosidad baja: no es el amarillo claro.
    assert.ok(accent.toLowerCase() !== '#f5d76e');
  });

  it('gris / inválido → fallback o casi negro', () => {
    assert.equal(resolveHeroAccentColor('#9CA3AF'), '#111827');
    assert.equal(resolveHeroAccentColor(null), HERO_FALLBACK_ACCENT);
    assert.equal(resolveHeroAccentColor('rojo'), HERO_FALLBACK_ACCENT);
  });
});

describe('buildHeroShiftCardModel · evento', () => {
  it('una línea de evento + lugar una vez + Nota; sin chips repetidos', () => {
    const m = buildHeroShiftCardModel({
      sectionBase: 'Turno actual',
      isToday: true,
      timeRange: '12:00–20:00',
      placement: peaje,
      ev: {
        nombre: 'general',
        eventoNombre: 'evento plaza',
        clienteNombre: 'Caminos',
        horarioBadge: '12:00–20:00',
        direccion: 'Plaza de La Musica',
        mapsUrl: 'https://maps.example/plaza',
        requisitos: 'test',
        instrucciones: null,
      },
      mapsUrl: 'https://maps.example/otro',
    });
    assert.equal(m.kind, 'evento');
    assert.equal(m.kicker, 'TURNO ACTUAL · HOY');
    assert.equal(m.timeRange, '12:00–20:00');
    assert.equal(m.whereTitle, 'Evento: evento plaza · servicio general');
    assert.equal(m.wherePlace, 'Plaza de La Musica');
    assert.equal(m.note, 'Nota: test');
    assert.equal(m.mapsUrl, 'https://maps.example/plaza');
    // No duplica el nombre del evento en wherePlace.
    assert.ok(!String(m.whereTitle).includes('Plaza de La Musica'));
  });
});

describe('buildHeroShiftCardModel · puesto / retenido / convocado', () => {
  it('puesto: cliente · objetivo y puesto abajo, sin repetir', () => {
    const m = buildHeroShiftCardModel({
      sectionBase: 'Turno actual',
      isToday: true,
      timeRange: '08:00–16:00',
      placement: {
        client: 'Cliente SA',
        objective: 'Peaje 9 Norte',
        position: 'Puesto 1',
        line: 'Cliente SA · Peaje 9 Norte · Puesto 1',
        objectiveLocation: null,
      },
      mapsUrl: 'https://maps.example/peaje',
    });
    assert.equal(m.kind, 'puesto');
    assert.equal(m.whereTitle, 'Cliente SA · Peaje 9 Norte');
    assert.equal(m.wherePlace, 'Puesto 1');
    assert.equal(m.note, null);
    assert.equal(m.mapsUrl, 'https://maps.example/peaje');
  });

  it('retenido y convocado futuros', () => {
    const ret = buildHeroShiftCardModel({
      sectionBase: 'Retenido',
      isToday: true,
      timeRange: '15:00–23:00',
      placement: peaje,
      isRetention: true,
    });
    assert.equal(ret.kind, 'retenido');
    assert.equal(ret.kicker, 'RETENIDO');
    assert.equal(ret.fileteTone, 'retention');
    assert.equal(ret.whereTitle, 'Caminos · Plaza de la Musica');
    assert.equal(ret.timeRange, '15:00–23:00');

    const cov = buildHeroShiftCardModel({
      sectionBase: 'Próximo turno',
      isToday: false,
      timeRange: '16:00–17:00',
      placement: peaje,
      isConvocado: true,
      empresaLabel: 'Pruebas SA',
    });
    assert.equal(cov.kind, 'convocado');
    assert.match(cov.kicker, /EN CAMINO/);
    assert.match(cov.kicker, /Pruebas SA/);
    assert.equal(cov.fileteTone, 'warning');
  });
});

describe('firmarAnexoDelTurno', () => {
  it('muestra Firmar anexo solo con código pendiente y contrato', () => {
    const si = firmarAnexoDelTurno({ anexoEstado: 'PENDIENTE', eventualContratoId: 'ctr_1' });
    assert.equal(si.visible, true);
    assert.equal(si.contratoId, 'ctr_1');
    assert.equal(si.label, LABEL_FIRMAR_ANEXO);
    assert.equal(firmarAnexoDelTurno({ anexoEstado: 'SIN_CANAL', eventualContratoId: 'ctr_1' }).visible, false);
    assert.equal(firmarAnexoDelTurno({ anexoEstado: 'NO_EXIGIDO', eventualContratoId: 'ctr_1' }).visible, false);
    assert.equal(firmarAnexoDelTurno({ anexoEstado: 'FIRMADO', eventualContratoId: 'ctr_1' }).visible, false);
    assert.equal(firmarAnexoDelTurno({ anexoEstado: 'PENDIENTE' }).visible, false);
    assert.equal(firmarAnexoDelTurno(null).visible, false);
  });
});
