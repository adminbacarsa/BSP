import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paresExt, parExtMismoObjetivo, type DatosImagen } from './imagenCronograma';
import { armarLeyenda, textoSumasExt, turnoDeObjetivos } from './leyendaModoRapido';

const base: DatosImagen = {
  titulo: 'Embozadora',
  subtitulo: 'Noviembre',
  dias: [],
  filas: [{
    nombre: 'CONTE',
    celdas: {
      '2026-11-01': { code: 'EM', ext: true, par: 'EM+EM2' },
      '2026-11-02': { code: 'EM' },
      '2026-11-03': { code: 'CA', segundoCodigo: 'EM2' },
    },
  }],
  pie: '',
};

const franjas = [
  { code: 'EM', startTime: '07:30', endTime: '15:30' },
  { code: 'EM2', startTime: '15:30', endTime: '19:30' },
];

describe('EXT en la imagen y la nomenclatura', () => {
  it('EXT es la extension del mismo objetivo', () => {
    assert.equal(parExtMismoObjetivo({
      code: 'EM', isExtended: true, coversBandCode: 'EM2', objectiveId: 'emb', coversObjectiveId: 'emb',
    }), 'EM+EM2');
    assert.equal(parExtMismoObjetivo({
      code: 'EM', isExtended: true, segmentFromTime: '15:30', segmentToTime: '19:30',
    }, franjas), 'EM+EM2');
    assert.equal(parExtMismoObjetivo({
      code: 'EM', isExtended: true, endTime: '19:30',
    }, franjas), 'EM+EM2');
    assert.equal(parExtMismoObjetivo({
      code: 'CA', isExtended: true, coversBandCode: 'EM2', objectiveId: 'cat', coversObjectiveId: 'emb',
    }), null);
    assert.equal(parExtMismoObjetivo({ code: 'CA' }), null);
  });

  it('la imagen no mete CA+EM2 en la referencia EXT', () => {
    assert.deepEqual(paresExt(base), ['EM+EM2']);
  });

  it('la leyenda nombra EXT como EM+EM2', () => {
    assert.equal(textoSumasExt(['EM+EM2', 'em+em2']), 'EM+EM2');
    const grupos = armarLeyenda(
      [{ name: 'Embozadora', shifts: [{ code: 'EM', startTime: '07:30', endTime: '15:30' }, { code: 'EM2', startTime: '15:30', endTime: '19:30' }] }],
      new Set(['EM', 'EM2']),
      ['EM+EM2'],
    );
    const otros = grupos.find((g) => g.titulo === 'Otros');
    const ext = otros?.chips.find((c) => c.code === 'EXT');
    assert.equal(ext?.horario, 'EM+EM2');
    assert.equal(ext?.detalle, 'Extensión del mismo objetivo');
  });

  it('la leyenda solo lee turnos de los objetivos que se ven, no los de toda la empresa', () => {
    const vista = new Set(['catedral', 'palace']);
    assert.equal(turnoDeObjetivos({ objectiveId: 'catedral' }, vista), true);
    assert.equal(turnoDeObjetivos({ objectiveId: 'otro-objetivo' }, vista), false);
    assert.equal(turnoDeObjetivos({}, vista), true);
    assert.equal(turnoDeObjetivos(null, vista), true);
  });
});
