import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_SCROLL_FILA_PX, pasoScrollArrastre, velocidadScrollBorde, ZONA_SCROLL_FILA_PX } from './scrollArrastreFila';

describe('velocidad de scroll al arrastrar una fila', () => {
  it('es 0 fuera de la zona y máxima en el borde', () => {
    assert.equal(ZONA_SCROLL_FILA_PX, 60);
    assert.equal(velocidadScrollBorde(60), 0);
    assert.equal(velocidadScrollBorde(90), 0);
    assert.equal(velocidadScrollBorde(0), MAX_SCROLL_FILA_PX);
    assert.equal(velocidadScrollBorde(-8), MAX_SCROLL_FILA_PX);
  });

  it('es proporcional a la cercanía al borde', () => {
    assert.equal(velocidadScrollBorde(30), MAX_SCROLL_FILA_PX / 2);
    assert.equal(velocidadScrollBorde(15), MAX_SCROLL_FILA_PX * 0.75);
    assert.equal(velocidadScrollBorde(45, 60, 16), 4);
  });

  it('cerca del borde superior de la grilla scrollea hacia arriba, no la página', () => {
    const paso = pasoScrollArrastre({
      clientY: 120,
      top: 100,
      bottom: 800,
      grillaPuedeScroll: true,
    });
    assert.equal(paso.grilla, -velocidadScrollBorde(20));
    assert.ok(paso.grilla < 0);
    assert.equal(paso.pagina, 0);
  });

  it('el encabezado sticky cuenta como borde del contenedor', () => {
    const sobreElEncabezado = pasoScrollArrastre({
      clientY: 108,
      top: 100,
      bottom: 800,
      grillaPuedeScroll: true,
    });
    assert.ok(sobreElEncabezado.grilla < -MAX_SCROLL_FILA_PX / 2);
    const alMedio = pasoScrollArrastre({
      clientY: 450,
      top: 100,
      bottom: 800,
      grillaPuedeScroll: true,
    });
    assert.deepEqual(alMedio, { grilla: 0, pagina: 0 });
  });

  it('cerca del borde inferior scrollea hacia abajo', () => {
    const paso = pasoScrollArrastre({
      clientY: 770,
      top: 100,
      bottom: 800,
      grillaPuedeScroll: true,
    });
    assert.equal(paso.grilla, velocidadScrollBorde(30));
    assert.equal(paso.pagina, 0);
  });

  it('si la grilla está entera visible, el mismo delta va a la página', () => {
    const paso = pasoScrollArrastre({
      clientY: 770,
      top: 100,
      bottom: 800,
      grillaPuedeScroll: false,
    });
    assert.equal(paso.grilla, 0);
    assert.equal(paso.pagina, velocidadScrollBorde(30));
    const arriba = pasoScrollArrastre({
      clientY: 100,
      top: 100,
      bottom: 800,
      grillaPuedeScroll: false,
    });
    assert.equal(arriba.grilla, 0);
    assert.equal(arriba.pagina, -MAX_SCROLL_FILA_PX);
  });
});
