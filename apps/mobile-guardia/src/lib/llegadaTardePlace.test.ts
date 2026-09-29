/**
 * ¿Venís? en Hoy: objetivo y puesto reales, nunca «tu puesto».
 * node --experimental-strip-types --test src/lib/llegadaTardePlace.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { llegadaTardePlaceLabel } from './llegadaTardePlace.ts';

const map: Record<string, ObjectiveLocation> = {
  'obj-araya': {
    lat: 0,
    lng: 0,
    name: 'ARAYA',
    clientName: 'Cliente Sur',
  },
};

describe('llegadaTardePlaceLabel', () => {
  it('usa el turno cuando la convocatoria no trae nombres', () => {
    const shifts: Shift[] = [
      {
        id: 'turno-1',
        objectiveId: 'obj-araya',
        positionName: 'Portería',
      },
    ];
    const label = llegadaTardePlaceLabel({ id: 'c1', type: 'LLEGADA_TARDE', status: 'PENDING', shiftId: 'turno-1' }, shifts, map);
    assert.equal(label, 'ARAYA · Portería');
    assert.equal(label.includes('tu puesto'), false);
  });

  it('prioriza objetivo y puesto de la convocatoria', () => {
    const label = llegadaTardePlaceLabel(
      {
        id: 'c2',
        type: 'LLEGADA_TARDE',
        status: 'PENDING',
        shiftId: 'otro',
        objectiveName: 'Planta Norte',
        positionName: 'Acceso',
      },
      [{ id: 'otro', objectiveName: 'Viejo', positionName: 'Otro' }],
    );
    assert.equal(label, 'Planta Norte · Acceso');
  });

  it('no cae en tu puesto si faltan datos', () => {
    const label = llegadaTardePlaceLabel(
      { id: 'c3', type: 'LLEGADA_TARDE', status: 'PENDING', objectiveName: 'tu puesto' },
      [],
    );
    assert.equal(label.includes('tu puesto'), false);
    assert.match(label, /Objetivo no indicado/);
  });
});
