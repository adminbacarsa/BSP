import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clasificarSeleccionLicencia,
  diasQueQuedaron,
  esCeldaLicencia,
  iniciarRecorrido,
  siguienteRecorrido,
  textoCubrirDias,
  textoFranjaRecorrido,
  textoRepetirQuedaron,
} from './seleccionLicencia';

test('todas las licencias son la misma celda; franco y turno no', () => {
  for (const code of ['V', 'L', 'E', 'A', 'PG', 'ART', 'SGS', 'SUS', 'AA', 'LT']) {
    assert.equal(esCeldaLicencia({ code }), true, code);
  }
  assert.equal(esCeldaLicencia({ code: 'M' }), false);
  assert.equal(esCeldaLicencia({ code: 'F' }), false);
  assert.equal(esCeldaLicencia({ code: 'FT' }), false);
  assert.equal(esCeldaLicencia({ tieneAusencia: true, code: 'M' }), true);
  assert.equal(esCeldaLicencia({ code: 'MAVIC', codigosCatalogo: ['MAVIC'] }), true);
  assert.equal(esCeldaLicencia({ code: 'MAVIC' }), false);
});

test('selección de licencias: cubrir, mezcla y motivo', () => {
  const dias = ['2026-10-11', '2026-10-12', '2026-10-20'].map((dateStr) => ({
    empId: 'mart', dateStr, code: 'V', tieneAusencia: true,
  }));
  const solo = clasificarSeleccionLicencia(dias);
  assert.equal(solo.soloLicencias, true);
  assert.equal(solo.mismoTitular, true);
  assert.equal(textoCubrirDias(solo.dias), 'Cubrir 3 días (11/10 → 20/10)');
  assert.match(solo.motivoTurno, /Tiene V/);

  const mezcla = clasificarSeleccionLicencia([
    ...dias.slice(0, 1),
    { empId: 'mart', dateStr: '2026-10-21', code: 'M' },
  ]);
  assert.equal(mezcla.mezcla, true);
  assert.equal(mezcla.normales.length, 1);
  assert.equal(mezcla.salteadas, 1);

  const dos = clasificarSeleccionLicencia([
    { empId: 'a', dateStr: '2026-10-11', code: 'V', tieneAusencia: true },
    { empId: 'b', dateStr: '2026-10-11', code: 'L', tieneAusencia: true },
  ]);
  assert.equal(dos.mismoTitular, false);
});

test('recorrido día por día: saltear y repetir lo que quedó', () => {
  const rec = iniciarRecorrido(['2026-10-12', '2026-10-11', '2026-10-13']);
  assert.ok(rec);
  assert.equal(rec!.dias[0], '2026-10-11');
  assert.equal(textoFranjaRecorrido(rec!, 'N', '23:00–07:00', 'elegí quién cubre'), 'Día 1 de 3 · 11/10 · N 23:00–07:00 · elegí quién cubre');
  const salteo = siguienteRecorrido(rec!, false);
  assert.equal(salteo?.indice, 1);
  assert.deepEqual(salteo?.hechos, []);
  const hecho = siguienteRecorrido(salteo!, true);
  assert.deepEqual(hecho?.hechos, ['2026-10-12']);
  assert.equal(siguienteRecorrido(hecho!, true), null);
  const quedaron = diasQueQuedaron({ dias: rec!.dias, indice: 2, hechos: ['2026-10-12', '2026-10-13'] }, () => false);
  assert.deepEqual(quedaron, ['2026-10-11']);
  assert.match(textoRepetirQuedaron(quedaron), /día que quedó \(11\/10\)/);
  assert.equal(iniciarRecorrido(['2026-10-11']), null);
});
