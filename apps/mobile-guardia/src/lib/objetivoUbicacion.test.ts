/**
 * Ubicación del objetivo del turno: objetivo solo en `clients.objetivos[]`, lectura denegada,
 * objetivo inexistente. Nunca «sin ubicación» por un error de lectura.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/objetivoUbicacion.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObjectivesMap,
  findEmbeddedObjective,
  resolveObjectiveLocationForShift,
  type ObjectiveReader,
} from '../../../../packages/portal-core/src/objectives/loadObjectivesMap.ts';
import {
  OBJECTIVE_LOCATION_LOAD_ERROR,
  OBJECTIVE_NOT_FOUND_MESSAGE,
} from '../../../../packages/portal-core/src/objectives/objectiveMessages.ts';
import { validateCheckInDistance } from '../../../../packages/portal-core/src/checkIn/portalCheckIn.ts';

const PEAJE_ID = 'UJHqYnFeQfCEbYfVSMIi';
const CLIENT_ID = 'GHJOO3vW49gagLPOcoAw';
const peajeClient = {
  name: 'Caminos de las Sierras',
  empresaId: 'pruebas_sa',
  objetivos: [
    {
      id: PEAJE_ID,
      name: 'Peaje 9 Norte',
      lat: -31.1908,
      lng: -64.1529,
      address: 'Ruta 9 Norte',
      allowRemoteCheckIn: true,
    },
    { id: 'obj_sin_coords', name: 'Depósito', address: 'Sin geocodificar' },
  ],
};
const shift = { objectiveId: PEAJE_ID, objectiveName: 'Peaje 9 Norte', clientId: CLIENT_ID, empresaId: 'pruebas_sa' };

function denied(): never {
  const err = new Error('Missing or insufficient permissions.') as Error & { code?: string };
  err.code = 'permission-denied';
  throw err;
}

const readerOk: ObjectiveReader = {
  getClient: async (id) => (id === CLIENT_ID ? peajeClient : null),
  getObjetivo: async () => null,
  listClientsByEmpresa: async () => [{ id: CLIENT_ID, data: peajeClient }],
};
const readerDenied: ObjectiveReader = {
  getClient: async () => denied(),
  getObjetivo: async () => denied(),
  listClientsByEmpresa: async () => denied(),
};
const readerVacio: ObjectiveReader = {
  getClient: async () => null,
  getObjetivo: async () => null,
  listClientsByEmpresa: async () => [],
};

describe('ubicación del objetivo del turno', () => {
  it('el mapa toma el objetivo que solo existe dentro de clients.objetivos[]', () => {
    const map = buildObjectivesMap([], [{ id: CLIENT_ID, data: peajeClient }]);
    assert.equal(map[PEAJE_ID]?.lat, -31.1908);
    assert.equal(map[PEAJE_ID]?.lng, -64.1529);
    assert.equal(map[PEAJE_ID]?.allowRemoteCheckIn, true);
    assert.equal(map[PEAJE_ID]?.clientName, 'Caminos de las Sierras');
    assert.equal(map['Peaje 9 Norte']?.address, 'Ruta 9 Norte');
    assert.equal(findEmbeddedObjective(peajeClient, 'otro', 'Peaje 9 Norte')?.lat, -31.1908);
  });

  it('con el mapa vacío resuelve por clients/{clientId} y respeta allowRemoteCheckIn', async () => {
    const lookup = await resolveObjectiveLocationForShift(readerOk, shift, {});
    assert.equal(lookup.status, 'found');
    if (lookup.status !== 'found') return;
    assert.equal(lookup.source, 'client');
    assert.equal(lookup.location.allowRemoteCheckIn, true);
    // Remoto permitido: ficha aunque el GPS no responda.
    assert.deepEqual(validateCheckInDistance(lookup.location, null), { ok: true });
    // Lejos del objetivo también, porque el objetivo lo permite.
    assert.deepEqual(
      validateCheckInDistance(lookup.location, { latitude: -34.6, longitude: -58.38 }),
      { ok: true },
    );
  });

  it('sin clientId cae a objetivos/{id} y después a los clientes de la empresa', async () => {
    const porDoc = await resolveObjectiveLocationForShift(
      { ...readerVacio, getObjetivo: async () => ({ name: 'Peaje 9 Norte', lat: -31.19, lng: -64.15 }) },
      { objectiveId: PEAJE_ID },
    );
    assert.equal(porDoc.status, 'found');
    assert.equal(porDoc.status === 'found' && porDoc.source, 'objetivos');

    const porEmpresa = await resolveObjectiveLocationForShift(readerOk, {
      objectiveName: 'Peaje 9 Norte',
      empresaId: 'pruebas_sa',
    });
    assert.equal(porEmpresa.status, 'found');
    assert.equal(porEmpresa.status === 'found' && porEmpresa.source, 'empresa');
  });

  it('lectura denegada → error real, nunca «sin ubicación»', async () => {
    const lookup = await resolveObjectiveLocationForShift(readerDenied, shift, {});
    assert.equal(lookup.status, 'error');
    if (lookup.status !== 'error') return;
    assert.equal(lookup.message, OBJECTIVE_LOCATION_LOAD_ERROR);
    assert.equal(lookup.errors.length, 3);
    assert.doesNotMatch(lookup.message, /sin ubicaci/i);
  });

  it('el objetivo no existe en ninguna fuente → no encontrado (y la validación lo dice así)', async () => {
    const lookup = await resolveObjectiveLocationForShift(readerVacio, shift, {});
    assert.equal(lookup.status, 'not_found');
    const v = validateCheckInDistance(null, { latitude: -31.19, longitude: -64.15 });
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.message, OBJECTIVE_NOT_FOUND_MESSAGE);
    assert.doesNotMatch(!v.ok ? v.message : '', /sin ubicaci/i);
  });

  it('objetivo real sin coordenadas sigue fichando (no se bloquea)', async () => {
    const lookup = await resolveObjectiveLocationForShift(readerOk, {
      objectiveId: 'obj_sin_coords',
      clientId: CLIENT_ID,
    });
    assert.equal(lookup.status, 'found');
    if (lookup.status !== 'found') return;
    assert.equal(lookup.location.lat, 0);
    assert.deepEqual(validateCheckInDistance(lookup.location, null), { ok: true });
  });

  it('el mapa ya cargado gana y no lee Firestore', async () => {
    let reads = 0;
    const counting: ObjectiveReader = {
      getClient: async () => { reads += 1; return null; },
      getObjetivo: async () => { reads += 1; return null; },
      listClientsByEmpresa: async () => { reads += 1; return []; },
    };
    const map = buildObjectivesMap([], [{ id: CLIENT_ID, data: peajeClient }]);
    const lookup = await resolveObjectiveLocationForShift(counting, shift, map);
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.status === 'found' && lookup.source, 'map');
    assert.equal(reads, 0);
  });
});
