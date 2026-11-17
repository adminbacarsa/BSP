import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paresExt, type DatosImagen } from './imagenCronograma';
import { armarLeyenda, textoSumasExt } from './leyendaModoRapido';

const base: DatosImagen = {
  titulo: 'Embozadora',
  subtitulo: 'Noviembre',
  dias: [],
  filas: [{
    nombre: 'CONTE',
    celdas: {
      '2026-11-01': { code: 'EM', segundoCodigo: 'EM2', ext: true },
      '2026-11-02': { code: 'EM' },
      '2026-11-03': { code: 'CA', segundoCodigo: 'EM2' },
    },
  }],
  pie: '',
};

describe('EXT en la imagen y la nomenclatura', () => {
  it('junta los pares del sobre turno', () => {
    assert.deepEqual(paresExt(base), ['CA+EM2', 'EM+EM2']);
  });

  it('la leyenda nombra EXT como la suma de los dos turnos', () => {
    assert.equal(textoSumasExt(['EM+EM2', 'em+em2', 'CA+EM2']), 'CA+EM2 · EM+EM2');
    const grupos = armarLeyenda(
      [{ name: 'Embozadora', shifts: [{ code: 'EM', startTime: '07:30', endTime: '15:30' }, { code: 'EM2', startTime: '15:30', endTime: '19:30' }] }],
      new Set(['EM', 'EM2']),
      ['EM+EM2'],
    );
    const otros = grupos.find((g) => g.titulo === 'Otros');
    const ext = otros?.chips.find((c) => c.code === 'EXT');
    assert.equal(ext?.horario, 'EM+EM2');
    assert.equal(ext?.detalle, 'Suma de los dos turnos');
  });
});
