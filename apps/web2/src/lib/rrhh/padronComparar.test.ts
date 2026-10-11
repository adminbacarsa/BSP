import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filasDesdeHoja, type FilaPadron } from '@/lib/planificacion/padronAlta';
import { compararPadron, type EmpleadoParaPadron } from './padronComparar';

function fila(p: Partial<FilaPadron> & Pick<FilaPadron, 'legajo' | 'apellido' | 'nombre'>): FilaPadron {
  return {
    dni: '30111222', cuil: '20301112226', mail: 'a@ejemplo.test', telefono: '351000',
    domicilio: 'Calle 1', tipo: 'Mensual', area: 'Ops', puesto: 'Vigilador', objetivo: 'Peaje',
    nacimiento: '1990-01-01', genero: 'M', ingreso: '2020-01-01', estado: 'Activo', ultimaActividad: '',
    ...p,
  };
}

function emp(p: Partial<EmpleadoParaPadron> & Pick<EmpleadoParaPadron, 'id' | 'legajo'>): EmpleadoParaPadron {
  return {
    apellido: 'PEREZ', nombre: 'JUAN', dni: '30111222', cuil: '20301112226', mail: 'a@ejemplo.test',
    telefono: '351000', domicilio: 'Calle 1', puesto: 'Vigilador', estado: 'activo', ingreso: '2020-01-01',
    activo: true, ...p,
  };
}

describe('padrón contra legajos', () => {
  it('detecta encabezado y arma la fila sintética', () => {
    const con = filasDesdeHoja([
      ['Legajo', 'Apellido', 'Nombre', 'DNI', 'CUIL'],
      ['9001', 'PEREZ', 'JUAN', '30111222', '20301112226', 'a@ejemplo.test', '351', 'Calle 1', 'Mensual', 'Ops', 'Vigilador', 'Peaje', '1990-01-01', 'M', '', '', '2020-03-01', '', 'Activo', '2026-10-01'],
    ]);
    const sin = filasDesdeHoja([
      ['9001', 'PEREZ', 'JUAN', '30111222', '20301112226'],
    ]);
    assert.equal(con.length, 1);
    assert.equal(sin.length, 1);
    assert.equal(con[0].apellido, 'PEREZ');
    assert.equal(con[0].ingreso, '2020-03-01');
    assert.equal(con[0].ultimaActividad, '2026-10-01');
  });

  it('separa nuevos, cambios campo por campo, bajas e iguales', () => {
    const filas = [
      fila({ legajo: '1001', apellido: 'NUEVO', nombre: 'ANA', dni: '11111111', cuil: '20111111112' }),
      fila({ legajo: '1002', apellido: 'GOMEZ', nombre: 'LUIS', mail: 'nuevo@ejemplo.test', telefono: '351999' }),
      fila({ legajo: '1004', apellido: 'DIAZ', nombre: 'MARIA' }),
    ];
    const empleados = [
      emp({ id: 'e2', legajo: '1002', apellido: 'GOMEZ', nombre: 'LUIS', mail: 'viejo@ejemplo.test', telefono: '351000' }),
      emp({ id: 'e3', legajo: '1003', apellido: 'LOPEZ', nombre: 'CARLA' }),
      emp({ id: 'e4', legajo: '1004', apellido: 'DIAZ', nombre: 'MARIA' }),
    ];
    const c = compararPadron(filas, empleados);
    assert.equal(c.nuevos.length, 1);
    assert.equal(c.nuevos[0].fila.apellido, 'NUEVO');
    assert.equal(c.cambios.length, 1);
    assert.deepEqual(c.cambios[0].diffs.map((d) => d.campo).sort(), ['mail', 'teléfono']);
    assert.equal(c.cambios[0].diffs.find((d) => d.campo === 'mail')?.antes, 'viejo@ejemplo.test');
    assert.equal(c.cambios[0].diffs.find((d) => d.campo === 'mail')?.despues, 'nuevo@ejemplo.test');
    assert.equal(c.bajas.length, 1);
    assert.equal(c.bajas[0].empleado.apellido, 'LOPEZ');
    assert.equal(c.bajas[0].motivo, 'no_viene');
    assert.equal(c.iguales.length, 1);
    assert.equal(c.iguales[0].empleado.apellido, 'DIAZ');
  });

  it('un activo que el padrón da de baja no es un cambio: queda para revisar', () => {
    const c = compararPadron(
      [fila({ legajo: '1002', apellido: 'GOMEZ', nombre: 'LUIS', estado: 'Baja' })],
      [emp({ id: 'e2', legajo: '1002', apellido: 'GOMEZ', nombre: 'LUIS' })],
    );
    assert.equal(c.bajas.length, 1);
    assert.equal(c.bajas[0].motivo, 'baja_padron');
    assert.equal(c.cambios.length, 0);
  });
});
