import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opcionesGrupoVista, rotuloGrupoVista } from './grupoDesplegable';

test('el rótulo es el grupo, o el grupo y el objetivo si se ve uno solo', () => {
  assert.equal(rotuloGrupoVista('NIÑOS Y CASA RONALD', true, 'H. de Niños'), 'NIÑOS Y CASA RONALD');
  assert.equal(rotuloGrupoVista('NIÑOS Y CASA RONALD', false, 'H. de Niños'), 'NIÑOS Y CASA RONALD › H. de Niños');
  assert.equal(rotuloGrupoVista('NIÑOS Y CASA RONALD', false, ''), 'NIÑOS Y CASA RONALD');
});

test('las opciones son Todos, cada objetivo y Salir; el cliente solo si difiere', () => {
  const mismo = opcionesGrupoVista({
    objectiveIds: ['ninos', 'casa'],
    objectiveNames: ['H. de Niños', 'Casa Mc Donalds'],
    clientes: ['Ministerio', 'Ministerio'],
    clienteGrupo: 'Ministerio',
    vistaAgrupada: true,
    objectiveIdActivo: 'ninos',
  });
  assert.deepEqual(mismo.map((o) => o.nombre), [
    'Todos (vista agrupada)',
    'H. de Niños',
    'Casa Mc Donalds',
    'Salir del grupo',
  ]);
  assert.equal(mismo[0].activa, true);
  assert.equal(mismo[1].activa, false);
  assert.equal(mismo[1].subtitulo, 'Ver este objetivo');
  assert.equal(mismo[0].subtitulo, 'H. de Niños · Casa Mc Donalds');

  const uno = opcionesGrupoVista({
    objectiveIds: ['ninos', 'casa'],
    objectiveNames: ['H. de Niños', 'Casa Mc Donalds'],
    clientes: ['Ministerio', 'Ministerio'],
    clienteGrupo: 'Ministerio',
    vistaAgrupada: false,
    objectiveIdActivo: 'casa',
  });
  assert.equal(uno[0].activa, false);
  assert.equal(uno.find((o) => o.objectiveId === 'casa')?.activa, true);

  const mixto = opcionesGrupoVista({
    objectiveIds: ['ninos', 'casa'],
    objectiveNames: ['H. de Niños', 'Casa Mc Donalds'],
    clientes: ['Ministerio', 'Otra SA'],
    clienteGrupo: 'Ministerio',
    vistaAgrupada: true,
  });
  assert.equal(mixto[1].subtitulo, 'Ministerio');
  assert.equal(mixto[2].subtitulo, 'Otra SA');
});
