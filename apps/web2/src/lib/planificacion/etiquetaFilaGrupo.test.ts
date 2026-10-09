import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { etiquetaFilaGrupo, partesObjetivo, puestoDeTurno } from './etiquetaFilaGrupo';

const objetivos = [
  { id: 'ninos', nombre: 'H. de Niños' },
  { id: 'casa', nombre: 'Casa Mc Donalds' },
];

describe('etiqueta de la fila en el grupo', () => {
  it('acorta H. de Niños a Niños y Casa Mc Donalds a Casa Mc', () => {
    assert.deepEqual(partesObjetivo('H. de Niños'), { corto: 'Niños', sigla: 'N' });
    assert.deepEqual(partesObjetivo('Casa Mc Donalds'), { corto: 'Casa Mc', sigla: 'CMD' });
  });

  it('un solo puesto y objetivo', () => {
    const et = etiquetaFilaGrupo(
      Array.from({ length: 20 }, () => ({ puesto: 'Internado', objetivoId: 'ninos' })),
      objetivos,
    );
    assert.ok(et);
    assert.equal(et.puesto, 'Internado');
    assert.equal(et.objetivoVisible, 'Niños');
    assert.equal(et.tooltip, 'Internado · H. de Niños');
  });

  it('con varios puestos u objetivos muestra el más frecuente y el resto en el tooltip', () => {
    const fuentes = [
      ...Array.from({ length: 18 }, () => ({ puesto: 'Internado', objetivoId: 'ninos' })),
      ...Array.from({ length: 4 }, () => ({ puesto: 'Playa', objetivoId: 'casa' })),
      ...Array.from({ length: 2 }, () => ({ puesto: 'Guardia', objetivoId: 'ninos' })),
    ];
    const et = etiquetaFilaGrupo(fuentes, objetivos);
    assert.ok(et);
    assert.equal(et.puesto, 'Internado');
    assert.equal(et.objetivoId, 'ninos');
    assert.equal(et.objetivoVisible, 'Niños');
    assert.match(et.tooltip, /También: Playa · Casa Mc Donalds/);
    assert.match(et.tooltip, /Guardia · H\. de Niños/);
    assert.doesNotMatch(et.tooltip, /^Playa/);
  });

  it('un nombre largo se muestra como sigla', () => {
    const et = etiquetaFilaGrupo(
      [{ puesto: 'Rondin', objetivoId: 'x' }],
      [{ id: 'x', nombre: 'Establecimiento Asistencial Regional' }],
    );
    assert.ok(et);
    assert.equal(et.objetivoCorto, 'Establecimiento');
    assert.equal(et.objetivoVisible, 'EAR');
  });

  it('ignora turnos de otro objetivo y un puesto vacío', () => {
    const et = etiquetaFilaGrupo(
      [
        { puesto: 'Proveedores', objetivoId: 'ajeno' },
        { puesto: '', objetivoId: 'casa' },
        { puesto: 'Guardia', objetivoId: 'casa' },
      ],
      objetivos,
    );
    assert.ok(et);
    assert.equal(et.puesto, 'Guardia');
    assert.equal(et.objetivoVisible, 'Casa Mc');
    assert.equal(et.tooltip, 'Guardia · Casa Mc Donalds');
  });

  it('la licencia conserva el puesto original', () => {
    assert.equal(puestoDeTurno({ positionName: 'General', originalPositionName: 'Internado' }), 'Internado');
    assert.equal(puestoDeTurno({ positionName: 'Playa' }), 'Playa');
  });
});
