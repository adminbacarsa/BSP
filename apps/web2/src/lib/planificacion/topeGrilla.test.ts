import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diaQuePasaElTope,
  marcaTopeDesde,
  textoTooltipCeldaTope,
  textoTooltipFilaTope,
} from './topeGrilla';

test('el tope se cruza el día en que el acumulado pasa 200', () => {
  const dias = Array.from({ length: 31 }, (_, i) => ({
    dateStr: `2026-10-${String(i + 1).padStart(2, '0')}`,
    horas: 12,
  }));
  const cruce = diaQuePasaElTope(dias);
  assert.equal(cruce?.dateStr, '2026-10-17');
  assert.equal(cruce?.acumuladas, 204);
  assert.equal(cruce?.total, 372);
  assert.equal(marcaTopeDesde('2026-10-16', cruce!.dateStr), false);
  assert.equal(marcaTopeDesde('2026-10-17', cruce!.dateStr), true);
  assert.equal(marcaTopeDesde('2026-10-31', cruce!.dateStr), true);
  assert.equal(diaQuePasaElTope(dias.slice(0, 16)), null);
  const conFranco = [
    { dateStr: '2026-10-01', horas: 192 },
    { dateStr: '2026-10-02', horas: 0 },
    { dateStr: '2026-10-03', horas: 12 },
  ];
  assert.equal(diaQuePasaElTope(conFranco)?.dateStr, '2026-10-03');
  assert.equal(textoTooltipCeldaTope(372), 'Desde acá pasa las 200 h del mes (372 h)');
  assert.equal(textoTooltipFilaTope(cruce!, 'Mauro Martinez'), 'Pasa el tope de 200 h el 17/10 · autorizado por Mauro Martinez');
  assert.equal(textoTooltipFilaTope(cruce!), 'Pasa el tope de 200 h el 17/10');
});
