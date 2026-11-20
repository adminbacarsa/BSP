/**
 * Retenes para un destino: distancia, conocimiento del objetivo y orden sugerido.
 *
 * npx tsx --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/operaciones/retenesParaDestino.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compararRetenesEvaluados,
  evaluarRetenParaDestino,
  formatearDistancia,
  type DestinoRetenEval,
  type EmpleadoRetenInfo,
} from './retenesParaDestino';

const DESTINO: DestinoRetenEval = { objectiveId: 'obj-1', lat: -31.42, lng: -64.18, positionName: 'Puesto 1' };

const CERCA: EmpleadoRetenInfo = { lat: -31.43, lng: -64.19 };
const LEJOS: EmpleadoRetenInfo = { lat: -31.9, lng: -64.5 };

describe('evaluarRetenParaDestino', () => {
  it('calcula distancia y minutos hacia el objetivo', () => {
    const ev = evaluarRetenParaDestino('e1', CERCA, DESTINO);
    assert.equal(ev.hasGeo, true);
    assert.ok(ev.distanceKm != null && ev.distanceKm > 0 && ev.distanceKm < 5);
    assert.ok((ev.etaMinutes ?? 0) >= 1);
    assert.equal(ev.dentroRadio, true);
  });

  it('marca fuera de radio a quien vive a más de 15 km', () => {
    const ev = evaluarRetenParaDestino('e2', LEJOS, DESTINO);
    assert.ok((ev.distanceKm ?? 0) > 15);
    assert.equal(ev.dentroRadio, false);
  });

  it('sin domicilio geocodificado no se descarta y explica el motivo', () => {
    const ev = evaluarRetenParaDestino('e3', {}, DESTINO);
    assert.equal(ev.hasGeo, false);
    assert.equal(ev.geoMiss, 'legajo');
    assert.equal(ev.dentroRadio, true);
    assert.equal(formatearDistancia(ev), 'Sin domicilio geocodificado');
  });

  it('objetivo sin coordenadas: motivo objetivo', () => {
    const ev = evaluarRetenParaDestino('e4', CERCA, { objectiveId: 'obj-x' });
    assert.equal(ev.geoMiss, 'objetivo');
    assert.equal(formatearDistancia(ev), 'Objetivo sin ubicación');
  });

  it('titular del objetivo, conocido por turnos y sin experiencia', () => {
    const titular = evaluarRetenParaDestino('t', { ...CERCA, preferredObjectiveId: 'obj-1' }, DESTINO);
    assert.equal(titular.nivel, 'TITULAR');
    assert.equal(titular.esTitular, true);

    const conocido = evaluarRetenParaDestino(
      'c',
      {
        ...CERCA,
        experienciaObjetivos: {
          'obj-1': { turnosRegulares: 5, posicionesConocidas: ['Puesto 1'] },
        },
      },
      DESTINO,
    );
    assert.equal(conocido.nivel, 'CONOCIDO');
    assert.equal(conocido.turnosEnObjetivo, 5);
    assert.equal(conocido.conocePuesto, true);

    const nuevo = evaluarRetenParaDestino('n', CERCA, DESTINO);
    assert.equal(nuevo.nivel, 'NINGUNO');
    assert.equal(nuevo.turnosEnObjetivo, 0);
  });

  it('lee la última presencia desde Timestamp, Date o ISO', () => {
    const base = Date.UTC(2026, 10, 1, 12, 0, 0);
    const conTs = evaluarRetenParaDestino(
      'a',
      { experienciaObjetivos: { 'obj-1': { ultimaPresencia: { toMillis: () => base } } } },
      DESTINO,
    );
    assert.equal(conTs.ultimaPresenciaMs, base);
    const conIso = evaluarRetenParaDestino(
      'b',
      { experienciaObjetivos: { 'obj-1': { ultimaPresencia: new Date(base).toISOString() } } },
      DESTINO,
    );
    assert.equal(conIso.ultimaPresenciaMs, base);
  });
});

describe('compararRetenesEvaluados', () => {
  const cercaNuevo = evaluarRetenParaDestino('cerca-nuevo', CERCA, DESTINO);
  const lejosTitular = evaluarRetenParaDestino('lejos-titular', { ...LEJOS, preferredObjectiveId: 'obj-1' }, DESTINO);
  const cercaConocido = evaluarRetenParaDestino(
    'cerca-conocido',
    { lat: -31.425, lng: -64.185, experienciaObjetivos: { 'obj-1': { turnosRegulares: 4 } } },
    DESTINO,
  );
  const sinGeo = evaluarRetenParaDestino('sin-geo', {}, DESTINO);

  it('cercanía: dentro del radio primero, después menor distancia', () => {
    const orden = [lejosTitular, cercaNuevo, sinGeo, cercaConocido]
      .sort((a, b) => compararRetenesEvaluados(a, b, 'cercania'))
      .map((r) => r.employeeId);
    assert.deepEqual(orden.slice(0, 2), ['cerca-conocido', 'cerca-nuevo']);
    assert.equal(orden[orden.length - 1], 'lejos-titular');
  });

  it('conocimiento: titular primero aunque esté lejos', () => {
    const orden = [cercaNuevo, cercaConocido, lejosTitular]
      .sort((a, b) => compararRetenesEvaluados(a, b, 'conocimiento'))
      .map((r) => r.employeeId);
    assert.deepEqual(orden, ['lejos-titular', 'cerca-conocido', 'cerca-nuevo']);
  });
});

describe('formatearDistancia', () => {
  it('formatea km y minutos', () => {
    const texto = formatearDistancia({ hasGeo: true, distanceKm: 3.24, etaMinutes: 6 });
    assert.equal(texto, '3,2 km · ~6 min');
    assert.equal(formatearDistancia({ hasGeo: true, distanceKm: 18.4, etaMinutes: 37 }), '18 km · ~37 min');
  });
});
