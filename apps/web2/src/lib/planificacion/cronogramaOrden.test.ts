import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CronogramaOverviewRow } from './planningCronogramaOverview';
import { ordenarFilasCronograma, siguienteOrden } from './cronogramaOrden';

function fila(p: Partial<CronogramaOverviewRow> & Pick<CronogramaOverviewRow, 'lookupKey'>): CronogramaOverviewRow {
  return {
    clientId: 'c',
    clientName: 'Cliente',
    objectiveId: 'o',
    objectiveName: 'Objetivo',
    year: 2026,
    month: 10,
    estado: 'PUBLICADO',
    draftShifts: 0,
    publishedShifts: 0,
    totalShifts: 0,
    openVacancies: 0,
    plannedHours: 0,
    planDraftHours: 0,
    publishedBy: '',
    publishedAt: null,
    lastModifiedAt: null,
    lastModifiedBy: '',
    shortRestGaps: 0,
    shortRestDetail: '',
    ...p,
  };
}

const d = (iso: string) => new Date(iso);

describe('orden de Estado de cronogramas', () => {
  it('estado: primero lo que pide acción, Publicado al final', () => {
    const rows = [
      fila({ lookupKey: 'p', estado: 'PUBLICADO', objectiveName: 'A' }),
      fila({ lookupKey: 's', estado: 'SIN_DATOS', objectiveName: 'B' }),
      fila({ lookupKey: 'c', estado: 'PUBLICADO_CON_CAMBIOS', objectiveName: 'C' }),
      fila({ lookupKey: 'b', estado: 'BORRADOR', objectiveName: 'D' }),
    ];
    const asc = ordenarFilasCronograma(rows, { columna: 'estado', direccion: 'asc' }).map((r) => r.estado);
    assert.deepEqual(asc, ['PUBLICADO_CON_CAMBIOS', 'BORRADOR', 'SIN_DATOS', 'PUBLICADO']);
    const desc = ordenarFilasCronograma(rows, { columna: 'estado', direccion: 'desc' }).map((r) => r.estado);
    assert.deepEqual(desc, ['PUBLICADO', 'SIN_DATOS', 'BORRADOR', 'PUBLICADO_CON_CAMBIOS']);
  });

  it('última modificación usa la fecha y deja los vacíos al final en los dos sentidos', () => {
    const rows = [
      fila({ lookupKey: 'v', objectiveName: 'Vacio' }),
      fila({ lookupKey: 'n', lastModifiedAt: d('2026-10-08T15:00:00Z'), objectiveName: 'Nuevo' }),
      fila({ lookupKey: 'i', lastModifiedAt: new Date(Number.NaN), objectiveName: 'Invalida' }),
      fila({ lookupKey: 'a', lastModifiedAt: d('2026-10-01T10:00:00Z'), objectiveName: 'Viejo' }),
    ];
    const asc = ordenarFilasCronograma(rows, { columna: 'modificacion', direccion: 'asc' }).map((r) => r.lookupKey);
    assert.deepEqual(asc, ['a', 'n', 'v', 'i']);
    const desc = ordenarFilasCronograma(rows, { columna: 'modificacion', direccion: 'desc' }).map((r) => r.lookupKey);
    assert.deepEqual(desc, ['n', 'a', 'v', 'i']);
  });

  it('modificado por es alfabético y los vacíos quedan al final', () => {
    const rows = [
      fila({ lookupKey: 'z', lastModifiedBy: 'ZOE' }),
      fila({ lookupKey: 'v', lastModifiedBy: '   ' }),
      fila({ lookupKey: 'a', lastModifiedBy: 'ana' }),
      fila({ lookupKey: 'm', lastModifiedBy: 'Mauro' }),
    ];
    const asc = ordenarFilasCronograma(rows, { columna: 'modificadoPor', direccion: 'asc' }).map((r) => r.lookupKey);
    assert.deepEqual(asc, ['a', 'm', 'z', 'v']);
    const desc = ordenarFilasCronograma(rows, { columna: 'modificadoPor', direccion: 'desc' }).map((r) => r.lookupKey);
    assert.deepEqual(desc, ['z', 'm', 'a', 'v']);
  });

  it('el primer clic en la fecha muestra la más nueva; el segundo invierte', () => {
    assert.deepEqual(siguienteOrden(null, 'modificacion'), { columna: 'modificacion', direccion: 'desc' });
    assert.deepEqual(siguienteOrden({ columna: 'modificacion', direccion: 'desc' }, 'modificacion'), { columna: 'modificacion', direccion: 'asc' });
    assert.deepEqual(siguienteOrden(null, 'estado'), { columna: 'estado', direccion: 'asc' });
  });
});
