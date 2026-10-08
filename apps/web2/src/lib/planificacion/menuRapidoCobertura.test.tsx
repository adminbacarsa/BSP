import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  celdaEsHuecoSla,
  clampMenuEnViewport,
  listasAsignarMenu,
  opcionesMenuRapido,
  rolDesdeTurno,
  textoMarcaMenuRapido,
} from './menuRapidoCobertura';

describe('opciones del menú rápido', () => {
  it('ausente con permiso: asignar, ext/adel y el modal', () => {
    const op = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: false, puedeEditar: true });
    assert.equal(op.clase, 'ausente');
    assert.equal(op.visible, true);
    assert.equal(op.asignar, true);
    assert.equal(op.extAdel, true);
    assert.equal(op.abrirCompleta, true);
    assert.equal(op.soloLectura, false);
  });

  it('hueco del SLA sin nadie: las mismas tres acciones', () => {
    assert.equal(celdaEsHuecoSla({ tieneTurno: false, tieneAusencia: false, faltaPaxEnPuesto: true }), true);
    assert.equal(celdaEsHuecoSla({ tieneTurno: true, tieneAusencia: false, faltaPaxEnPuesto: true }), false);
    const op = opcionesMenuRapido({ esAusente: false, esHueco: true, cubiertoPorOps: false, puedeEditar: true });
    assert.equal(op.clase, 'hueco');
    assert.equal(op.titulo, 'Cubrir hueco del SLA');
    assert.equal(op.asignar, true);
    assert.equal(op.extAdel, true);
    assert.equal(op.abrirCompleta, true);
  });

  it('cubierto por Operaciones: solo abrir el modal en lectura', () => {
    const op = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: true, puedeEditar: true });
    assert.equal(op.clase, 'ops');
    assert.equal(op.titulo, 'Cubierto desde Operaciones');
    assert.equal(op.asignar, false);
    assert.equal(op.extAdel, false);
    assert.equal(op.abrirCompleta, true);
    assert.equal(op.soloLectura, true);
  });

  it('sin permiso: no asigna ni parte el turno', () => {
    const op = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: false, puedeEditar: false });
    assert.equal(op.clase, 'sin_permiso');
    assert.equal(op.asignar, false);
    assert.equal(op.extAdel, false);
    assert.equal(op.soloLectura, true);
    assert.equal(op.abrirCompleta, true);
  });

  it('un turno laboral normal no abre el menú', () => {
    const op = opcionesMenuRapido({ esAusente: false, esHueco: false, cubiertoPorOps: false, puedeEditar: true });
    assert.equal(op.clase, 'no_aplica');
    assert.equal(op.visible, false);
  });
});

describe('lista Asignar a…', () => {
  const personas = [
    { id: 'libre', nombre: 'FERRERO, Juan', rol: 'FREE', enCronograma: true },
    { id: 'ret', nombre: 'GUERRERO, Marcos', rol: 'RETEN', enCronograma: true },
    { id: 'esc', nombre: 'BOSIO, Ana', rol: 'ESC', enCronograma: true },
    { id: 'ref', nombre: 'RIOS, Nicolás', rol: 'REF', enCronograma: true },
    { id: 'franco', nombre: 'FONTANA, Luis', rol: 'FRANCO', enCronograma: true },
    { id: 'lic', nombre: 'LOPEZ, Raúl', rol: 'LICENCIA', enCronograma: true },
    { id: 'trabaja', nombre: 'BAEZ, Pedro', rol: 'WORKING', enCronograma: true },
    { id: 'fuera', nombre: 'GALEANO, Marta', rol: 'FREE', enCronograma: false },
    { id: 'fuera-lic', nombre: 'BARROS, Luis', rol: 'LICENCIA', enCronograma: false },
    { id: 'fuera-trabaja', nombre: 'SOSA, Inés', rol: 'WORKING', enCronograma: false },
  ];

  it('ordena RET, ESC, REF y libre, y deja afuera al franco', () => {
    const { cronograma, fuera } = listasAsignarMenu(personas);
    assert.deepEqual(cronograma.map((p) => p.id), ['ret', 'esc', 'ref', 'libre']);
    assert.deepEqual(fuera.map((p) => p.id), ['fuera']);
  });

  it('el buscador de afuera no trae a quien tiene turno o licencia', () => {
    const { fuera } = listasAsignarMenu(personas, 'bar');
    assert.deepEqual(fuera.map((p) => p.id), []);
    const galeano = listasAsignarMenu(personas, 'gale');
    assert.deepEqual(galeano.fuera.map((p) => p.id), ['fuera']);
  });

  it('el rol del día coincide con el modal', () => {
    assert.equal(rolDesdeTurno(null), 'FREE');
    assert.equal(rolDesdeTurno({ code: 'RET' }), 'RETEN');
    assert.equal(rolDesdeTurno({ code: 'F', isFranco: true }), 'FRANCO');
    assert.equal(rolDesdeTurno({ code: 'L' }), 'LICENCIA');
    assert.equal(rolDesdeTurno({ code: 'M' }), 'WORKING');
  });
});

describe('marca y posición', () => {
  it('arma el tooltip de asignado y de Ext+Adel', () => {
    assert.equal(
      textoMarcaMenuRapido({
        modo: 'asignar',
        cubreA: 'ROSS, Carlos',
        tipo: 'RET',
        actor: 'Mauro',
        cuando: '08/10 09:30',
      }),
      'Cubre a ROSS · Asignado (RET) · por Mauro 08/10 09:30',
    );
    assert.equal(
      textoMarcaMenuRapido({ modo: 'split', ext: 'GALEANO, Marta', adel: 'BARROS, Luis' }),
      'Ext+Adel: GALEANO (ext) · BARROS (adel)',
    );
  });

  it('clampa el menú dentro de la ventana', () => {
    const pos = clampMenuEnViewport(1400, 860, 320, 220, 1440, 900);
    assert.ok(pos.left + 320 <= 1440 - 8);
    assert.ok(pos.top + 220 <= 900 - 8);
    assert.ok(pos.left >= 8);
    assert.ok(pos.top >= 8);
  });
});
