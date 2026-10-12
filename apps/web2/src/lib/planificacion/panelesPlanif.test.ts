import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filaFaltante,
  leerEstadoPaneles,
  resumenFaltantes,
  serializarEstadoPaneles,
  TEXTO_PIN_AVISOS,
  textoPastilla,
  textoPestana,
  ubicarCierre12,
} from './panelesPlanif';

test('la pastilla nombra los tres contadores', () => {
  assert.equal(textoPastilla(1, 1, 0), '1 faltante · 1 aviso · 0 consultas');
  assert.equal(textoPastilla(2, 0, 3), '2 faltantes · 0 avisos · 3 consultas');
});

test('las pestañas llevan el número', () => {
  assert.equal(textoPestana('faltantes', 4), 'Faltantes (4)');
  assert.equal(textoPestana('avisos', 1), 'Avisos (1)');
  assert.equal(textoPestana('consultas', 0), 'Consultas (0)');
});

test('el resumen y la fila del faltante separan día, puesto, banda y propuesta', () => {
  assert.equal(resumenFaltantes(1, 2), '1 con propuesta de 12 h · 2 para consultar franco');
  assert.equal(
    filaFaltante({ dateStr: '2026-10-02', positionName: 'Puesto 1', banda: 'T', propuestaTexto: 'REGALO D12 + HERRANTE N12' }),
    '02/10 · Puesto 1 · T · REGALO D12 + HERRANTE N12',
  );
  assert.equal(
    filaFaltante({ dateStr: '2026-10-03', positionName: 'Puesto 2', banda: 'N', propuestaTexto: '' }),
    '03/10 · Puesto 2 · N · sin par de 12 h',
  );
});

test('recuerda abierto y la pestaña', () => {
  const raw = serializarEstadoPaneles({ abierto: false, pestana: 'avisos' });
  assert.deepEqual(leerEstadoPaneles(raw), { abierto: false, pestana: 'avisos' });
  assert.equal(leerEstadoPaneles(null), null);
  assert.equal(leerEstadoPaneles('{'), null);
  assert.deepEqual(leerEstadoPaneles('{"abierto":1,"pestana":"otra"}'), { abierto: false, pestana: 'faltantes' });
});

test('el aviso de PIN es el de publicar', () => {
  assert.match(TEXTO_PIN_AVISOS, /PIN al publicar/);
  assert.match(TEXTO_PIN_AVISOS, /no se puede publicar/);
  assert.doesNotMatch(TEXTO_PIN_AVISOS, /al guardar/);
});

test('si el cartel de 12 h pisa el panel, pasa al otro lado de la celda', () => {
  const ancla = { left: 900, top: 400, width: 40, height: 28 };
  const panel = { left: 1100, top: 80, width: 320, height: 780 };
  const libre = ubicarCierre12({
    ancla,
    panel: null,
    viewport: { width: 1440, height: 900 },
    ancho: 420,
    alto: 220,
  });
  assert.equal(libre.lado, 'abajo');
  const chocando = ubicarCierre12({
    ancla,
    panel,
    viewport: { width: 1440, height: 900 },
    ancho: 420,
    alto: 220,
  });
  assert.notEqual(chocando.lado, 'abajo');
  const caja = { left: chocando.left, top: chocando.top, width: 420, height: 220 };
  const pisa = caja.left < panel.left + panel.width && caja.left + caja.width > panel.left
    && caja.top < panel.top + panel.height && caja.top + caja.height > panel.top;
  assert.equal(pisa, false);
  assert.ok(chocando.left + 420 <= 1440);
  assert.ok(chocando.top >= 8);
});
