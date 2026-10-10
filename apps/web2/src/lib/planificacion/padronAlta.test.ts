import assert from 'node:assert/strict';
import test from 'node:test';
import { cuilCheckDigit } from '@/lib/eventuales/cuil.mjs';
import {
  buscarEnPadron,
  decidirAlta,
  filasDesdeHoja,
  formDesdeFila,
  formVacio,
  type AltaForm,
  type LegajoConocido,
} from '@/lib/planificacion/padronAlta';
import { decidirActivarServicio } from '@/lib/planificacion/activarServicioMes';

function cuil(base10: string): string {
  return base10 + cuilCheckDigit(base10);
}

const CTX = { empresaId: 'bacarsa', objectiveId: 'obj1', clientId: 'cli1' };

function fila(partial: Partial<AltaForm> = {}): AltaForm {
  return {
    apellido: 'PEREZ',
    nombre: 'JUAN',
    legajo: '1500',
    dni: '30111222',
    cuil: cuil('2030111222'),
    mail: 'juan@ejemplo.test',
    telefono: '3510000000',
    domicilio: 'Calle 1',
    nacimiento: '1990-01-02',
    genero: 'M',
    ingreso: '2020-03-01',
    estadoPadron: 'Activo',
    puestoPadron: 'Vigilador',
    ...CTX,
    ...partial,
  };
}

test('lee la hoja sin encabezado y convierte fechas serial y dd/mm/aaaa', () => {
  const rows = [
    ['LEGAJO', 'APELLIDO'],
    ['1500', 'PEREZ', 'JUAN', '30.111.222', cuil('2030111222'), 'juan@ejemplo.test', '351', 'Calle 1', 'Planta', 'Ops', 'Vigilador', 'Objetivo', 32876, 'Masculino', '', '', '01/03/2020', '', 'Activo'],
  ];
  const [f] = filasDesdeHoja(rows);
  assert.equal(f.legajo, '1500');
  assert.equal(f.dni, '30111222');
  assert.equal(f.genero, 'M');
  assert.equal(f.nacimiento, '1990-01-03');
  assert.equal(f.ingreso, '2020-03-01');
  assert.equal(f.estado, 'Activo');
});

test('busca en el padrón por legajo y por apellido y nombre', () => {
  const filas = filasDesdeHoja([
    ['1500', 'PEREZ', 'JUAN', '30111222', cuil('2030111222')],
    ['1501', 'GARCIA', 'ANA', '27999888', cuil('2727999888')],
  ]);
  assert.equal(buscarEnPadron(filas, { legajo: '01501', nombre: 'X' })?.fila.apellido, 'GARCIA');
  assert.equal(buscarEnPadron(filas, { nombre: 'PEREZ, JUAN' })?.via, 'nombre');
  assert.equal(buscarEnPadron(filas, { nombre: 'GARCIA ANA MARIA' })?.via, 'parecido');
  assert.equal(buscarEnPadron(filas, { nombre: 'QUIROGA FABIAN' }), null);
  const vacio = formVacio('QUIROGA FABIAN', '', CTX);
  assert.equal(vacio.apellido, 'QUIROGA');
  assert.equal(vacio.nombre, 'FABIAN');
  assert.equal(formDesdeFila(filas[0], CTX).legajo, '1500');
});

test('el alta exige apellido, nombre, legajo, DNI y CUIL con dígito verificador', () => {
  assert.equal(decidirAlta(fila({ cuil: '20301112221' }), [], 'bacarsa').accion, 'bloquear');
  assert.match((decidirAlta(fila({ apellido: '' }), [], 'bacarsa') as { mensaje: string }).mensaje, /apellido/i);
  assert.match((decidirAlta(fila({ dni: '123' }), [], 'bacarsa') as { mensaje: string }).mensaje, /DNI/);
  const ok = decidirAlta(fila(), [], 'bacarsa');
  assert.equal(ok.accion, 'crear');
  if (ok.accion === 'crear') {
    assert.equal(ok.doc.category, 'Vigilador');
    assert.equal(ok.doc.preferredObjectiveId, 'obj1');
    assert.equal(ok.doc.empresaId, 'bacarsa');
    assert.equal(ok.doc.name, 'PEREZ, JUAN');
  }
});

test('legajo o DNI de la misma empresa bloquean; otra empresa se habilita; padrón inactivo avisa', () => {
  const mismo: LegajoConocido = { id: 'e1', empresaId: 'bacarsa', dni: '30111222', cuil: cuil('2030111222'), fileNumber: '1500', name: 'PEREZ, JUAN' };
  assert.match((decidirAlta(fila(), [mismo], 'bacarsa') as { mensaje: string }).mensaje, /legajo/);
  const otroDni: LegajoConocido = { ...mismo, fileNumber: '9999', dni: '30111222', cuil: cuil('2099999999') };
  assert.match((decidirAlta(fila({ legajo: '1502' }), [otroDni], 'bacarsa') as { mensaje: string }).mensaje, /DNI/);
  const otra: LegajoConocido = { id: 'e2', empresaId: 'grupos_bacar_sa', dni: '30111222', cuil: cuil('2030111222'), fileNumber: '1500', name: 'PEREZ, JUAN' };
  const hab = decidirAlta(fila({ estadoPadron: 'Baja' }), [otra], 'bacarsa');
  assert.equal(hab.accion, 'habilitar');
  if (hab.accion === 'habilitar') {
    assert.equal(hab.existente.id, 'e2');
    assert.match(hab.avisos.join(' '), /otra empresa/);
    assert.match(hab.avisos.join(' '), /Baja/);
  }
});

test('activar el mes: octubre que termina el 31 queda tildado para noviembre; cerrado o hueco no', () => {
  const oct = { id: 's1', startDate: '2026-10-01', endDate: '2026-10-31', closed: false };
  const nov = decidirActivarServicio({ slas: [oct], year: 2026, month: 11, clienteActivo: true });
  assert.equal(nov.mostrar, true);
  assert.equal(nov.marcado, true);
  assert.equal(nov.puede, true);
  assert.equal(nov.mes, 'noviembre');
  assert.equal(nov.newEndDate, '2026-11-30');
  assert.equal(decidirActivarServicio({ slas: [{ ...oct, endDate: '2026-11-30' }], year: 2026, month: 11, clienteActivo: true }).mostrar, false);
  const cerrado = decidirActivarServicio({ slas: [{ ...oct, closed: true }], year: 2026, month: 11, clienteActivo: true });
  assert.equal(cerrado.puede, false);
  assert.match(cerrado.motivo, /cerrado/);
  const cliente = decidirActivarServicio({ slas: [oct], year: 2026, month: 11, clienteActivo: false });
  assert.equal(cliente.puede, false);
  assert.match(cliente.motivo, /inactivo/);
  const hueco = decidirActivarServicio({ slas: [{ ...oct, endDate: '2026-08-31' }], year: 2026, month: 11, clienteActivo: true });
  assert.equal(hueco.marcado, false);
  assert.equal(hueco.puede, false);
  const adentro = decidirActivarServicio({ slas: [{ ...oct, endDate: '2026-11-15' }], year: 2026, month: 11, clienteActivo: true });
  assert.equal(adentro.puede, true);
  assert.equal(adentro.marcado, false);
});
