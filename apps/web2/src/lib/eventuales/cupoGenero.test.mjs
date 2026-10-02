import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparCandidatos, cuposDeServicio, estadoCupo, grupoDeGenero, grupoDeItem, normalizarCupoServicio, normalizarGenero,
  pendientesACerrar, porcentajeGrupo, puedeConfirmar, STATUS_CUPO_COMPLETO, textoCupoGrupo, textoCupoServicio, textoResumenCupo, validarCupoServicio,
} from './cupoGenero.mjs';

const porGenero = { cupoModo: 'POR_GENERO', cupoPorGenero: { M: 2, F: 1 } };
const indistinto = { cupo: 2 };

test('normalizarGenero: M / F / sin especificar, con variantes de importación', () => {
  assert.equal(normalizarGenero('M'), 'M');
  assert.equal(normalizarGenero('hombre'), 'M');
  assert.equal(normalizarGenero('Masculino'), 'M');
  assert.equal(normalizarGenero('F'), 'F');
  assert.equal(normalizarGenero('mujer'), 'F');
  assert.equal(normalizarGenero('Femenino'), 'F');
  assert.equal(normalizarGenero(''), '');
  assert.equal(normalizarGenero('X'), '');
  assert.equal(normalizarGenero(undefined), '');
});

test('normalizarCupoServicio: por género suma el total; indistinto conserva cupo', () => {
  assert.deepEqual(normalizarCupoServicio({ cupoModo: 'POR_GENERO', cupoPorGenero: { M: 20, F: 15 } }), { cupoModo: 'POR_GENERO', cupo: 35, cupoPorGenero: { M: 20, F: 15 } });
  assert.deepEqual(normalizarCupoServicio({ cupoModo: 'POR_GENERO', cupoM: '3', cupoF: '' }), { cupoModo: 'POR_GENERO', cupo: 3, cupoPorGenero: { M: 3, F: 0 } });
  assert.deepEqual(normalizarCupoServicio({ cupo: 35 }), { cupoModo: 'INDISTINTO', cupo: 35, cupoPorGenero: null });
  assert.deepEqual(normalizarCupoServicio({ cupo: '5', cupoModo: 'INDISTINTO', cupoPorGenero: { M: 9, F: 9 } }), { cupoModo: 'INDISTINTO', cupo: 5, cupoPorGenero: null });
  assert.equal(textoCupoServicio({ cupoModo: 'POR_GENERO', cupoPorGenero: { M: 20, F: 15 } }), '20 H · 15 M (35)');
  assert.equal(textoCupoServicio({ cupo: 35 }), '35 pax');
});

test('validarCupoServicio', () => {
  assert.deepEqual(validarCupoServicio({ cupo: 3 }), []);
  assert.equal(validarCupoServicio({ cupo: 0 }).length, 1);
  assert.deepEqual(validarCupoServicio({ cupoModo: 'POR_GENERO', cupoPorGenero: { M: 0, F: 2 } }), []);
  assert.equal(validarCupoServicio({ cupoModo: 'POR_GENERO', cupoPorGenero: { M: 0, F: 0 } }).length, 1);
});

test('grupos: indistinto = TODOS; por género = M y F; sin especificar no tiene grupo', () => {
  assert.deepEqual(cuposDeServicio(indistinto), [{ grupo: 'TODOS', label: 'Cupo', cupo: 2 }]);
  assert.deepEqual(cuposDeServicio(porGenero), [{ grupo: 'M', label: 'Hombres', cupo: 2 }, { grupo: 'F', label: 'Mujeres', cupo: 1 }]);
  assert.equal(grupoDeGenero(indistinto, ''), 'TODOS');
  assert.equal(grupoDeGenero(indistinto, 'F'), 'TODOS');
  assert.equal(grupoDeGenero(porGenero, 'M'), 'M');
  assert.equal(grupoDeGenero(porGenero, 'F'), 'F');
  assert.equal(grupoDeGenero(porGenero, ''), null);
  assert.equal(grupoDeItem(porGenero, { cupoGrupo: 'F' }), 'F');
  assert.equal(grupoDeItem(porGenero, { cupoGrupo: 'TODOS', genero: 'M' }), 'M');
  assert.equal(grupoDeItem(indistinto, { cupoGrupo: 'F' }), 'TODOS');
});

test('estadoCupo: cuenta por grupo, sin especificar no cuenta, completo por grupo', () => {
  const e = estadoCupo(porGenero, [{ genero: 'M' }, { cupoGrupo: 'F' }, { genero: '' }]);
  assert.equal(e.cupo, 3);
  assert.equal(e.ocupados, 2);
  assert.equal(e.sinGrupo, 1);
  assert.deepEqual(e.grupos.map((g) => [g.grupo, g.ocupados, g.disponibles, g.completo]), [['M', 1, 1, false], ['F', 1, 0, true]]);
  assert.equal(e.completo, false);
  assert.equal(textoCupoGrupo(e.grupos[0]), 'Hombres 1/2');
  assert.equal(textoCupoGrupo(e.grupos[1]), 'Mujeres 1/1 · completo');
  assert.equal(textoResumenCupo(e), 'Hombres 1/2 · Mujeres 1/1 completo');
  assert.equal(porcentajeGrupo(e.grupos[0]), 50);
  const i = estadoCupo(indistinto, [{ genero: 'M' }, { genero: '' }]);
  assert.equal(i.ocupados, 2);
  assert.equal(i.completo, true);
  assert.equal(textoResumenCupo(i), '2/2');
});

test('puedeConfirmar: por orden de aceptación dentro del grupo', () => {
  assert.equal(puedeConfirmar(porGenero, [], 'M').ok, true);
  assert.equal(puedeConfirmar(porGenero, [{ genero: 'M' }], 'M').ok, true);
  const lleno = puedeConfirmar(porGenero, [{ genero: 'M' }, { genero: 'M' }], 'M');
  assert.equal(lleno.ok, false);
  assert.equal(lleno.motivo, 'CUPO_COMPLETO');
  assert.equal(lleno.grupo, 'M');
  // Hombres lleno no bloquea a una mujer.
  assert.equal(puedeConfirmar(porGenero, [{ genero: 'M' }, { genero: 'M' }], 'F').ok, true);
  const sin = puedeConfirmar(porGenero, [], '');
  assert.equal(sin.ok, false);
  assert.equal(sin.motivo, 'GENERO_SIN_ESPECIFICAR');
  // Indistinto: un solo cupo y el género no importa.
  assert.equal(puedeConfirmar(indistinto, [{ genero: 'F' }], '').ok, true);
  assert.equal(puedeConfirmar(indistinto, [{ genero: 'F' }, { genero: 'M' }], 'F').motivo, 'CUPO_COMPLETO');
});

test('aceptaciones concurrentes: la regla aplicada en serie confirma solo a los primeros', () => {
  const ocupados = [];
  const resultados = ['M', 'M', 'M', 'F', 'F'].map((genero) => {
    const r = puedeConfirmar(porGenero, ocupados, genero);
    if (r.ok) ocupados.push({ genero, cupoGrupo: r.grupo });
    return r.ok;
  });
  assert.deepEqual(resultados, [true, true, false, true, false]);
});

test('pendientesACerrar: cierra solo las convocadas del grupo lleno', () => {
  const pendientes = [
    { id: 'h1', status: 'convocado', genero: 'M' },
    { id: 'h2', status: 'convocado', cupoGrupo: 'M' },
    { id: 'm1', status: 'convocado', genero: 'F' },
    { id: 'r1', status: 'rechazada', genero: 'M' },
  ];
  const cerrar = pendientesACerrar(porGenero, [{ genero: 'M' }, { genero: 'M' }], pendientes);
  assert.deepEqual(cerrar.map((p) => p.id), ['h1', 'h2']);
  assert.deepEqual(pendientesACerrar(porGenero, [{ genero: 'M' }], pendientes), []);
  assert.deepEqual(pendientesACerrar(indistinto, [{ genero: 'M' }, { genero: 'F' }], pendientes).map((p) => p.id), ['h1', 'h2', 'm1']);
  assert.equal(STATUS_CUPO_COMPLETO, 'cupo_completo');
});

test('agruparCandidatos: dos grupos con su ocupación, sin especificar aparte y mismo orden', () => {
  const cands = [{ id: 'a', genero: 'F' }, { id: 'b', genero: 'M' }, { id: 'c', genero: '' }, { id: 'd', genero: 'M' }];
  const g = agruparCandidatos(porGenero, cands, [{ genero: 'F' }]);
  assert.equal(g.porGenero, true);
  assert.deepEqual(g.grupos.map((x) => [x.grupo, x.candidatos.map((c) => c.id), x.ocupados, x.completo]), [['M', ['b', 'd'], 0, false], ['F', ['a'], 1, true]]);
  assert.deepEqual(g.sinEspecificar.map((c) => c.id), ['c']);
  const u = agruparCandidatos(indistinto, cands, []);
  assert.equal(u.porGenero, false);
  assert.deepEqual(u.grupos[0].candidatos.map((c) => c.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(u.sinEspecificar, []);
});
