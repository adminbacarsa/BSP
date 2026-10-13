import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clasificarPegado, indicesAsignados, lugarDeGuardia, sinEncontrarVisibles, textoGruposPegado, textoPlataforma, type ObjetivoCatalogo } from './pegarPersonas';
import { agregarFranjasAPosiciones, equivalenciaDeDefinicion, equivalenciaManual, equivalenciaOtroObjetivo, proponerDefinicion, proponerPuestoYBanda, textoCeldasVacias, yaDefinido } from './definirCodigo';
import { diagonal, alternarCelda, pegarForma } from './seleccionLibre';
import { cambiosHorarioServicio, tablaCodigosPlanilla, textoFueraDeServicio } from './codigosHorarioPegado';
import { puesto24Cerrado } from './lecturaBandas';
import type { FilaPegadoExcel } from './modoRapido';
import type { FilaPadron } from './padronAlta';

function peg(p: Partial<FilaPegadoExcel> & Pick<FilaPegadoExcel, 'nombre'>): FilaPegadoExcel {
  return { indice: 0, legajo: '', filaGrilla: null, via: null, celdas: [{ col: 0, code: 'M' }], desconocidos: [], ...p };
}

const padron: FilaPadron[] = [{
  legajo: '5001', apellido: 'SOSA', nombre: 'PEDRO', dni: '30111222', cuil: '20301112226',
  mail: '', telefono: '', domicilio: '', tipo: '', area: '', puesto: 'Vigilador', objetivo: '',
  nacimiento: '', genero: 'M', ingreso: '2024-01-01', estado: 'Activo', ultimaActividad: '',
}];

describe('orden de búsqueda al pegar', () => {
  it('grilla, después plataforma, después padrón, y si no está queda el alta manual', () => {
    const g = clasificarPegado(
      [
        peg({ indice: 0, nombre: 'PEREZ, JUAN', filaGrilla: 2, via: 'nombre' }),
        peg({ indice: 1, nombre: 'ACOSTA, JULIO', legajo: '3420' }),
        peg({ indice: 2, nombre: 'SOSA, PEDRO', legajo: '5001' }),
        peg({ indice: 3, nombre: 'NADIE, RARO' }),
      ],
      [{ id: 'a1', nombre: 'ACOSTA, JULIO', legajo: '3420', objetivoNombre: 'Peaje 9 Norte' }],
      padron,
    );
    assert.equal(g.enGrilla.length, 1);
    assert.equal(g.enPlataforma.length, 1);
    assert.equal(g.enPlataforma[0].persona.objetivoNombre, 'Peaje 9 Norte');
    assert.equal(g.paraAlta.length, 2);
    assert.equal(g.paraAlta[0].enPadron, true);
    assert.equal(g.paraAlta[1].enPadron, false);
    assert.match(textoGruposPegado(g), /En la grilla \(1\)/);
    assert.match(textoGruposPegado(g), /Para dar de alta \(2\)/);
    const asignados = new Set(g.enGrilla.map((f) => f.indice));
    const enPlat = new Set(g.enPlataforma.map((x) => x.fila.indice));
    const sin = sinEncontrarVisibles(
      [
        peg({ indice: 0, nombre: 'PEREZ, JUAN', filaGrilla: 2, via: 'nombre' }),
        peg({ indice: 1, nombre: 'ACOSTA, JULIO', legajo: '3420' }),
        peg({ indice: 2, nombre: 'SOSA, PEDRO', legajo: '5001' }),
        peg({ indice: 3, nombre: 'NADIE, RARO' }),
      ],
      asignados,
      enPlat,
    );
    assert.deepEqual(sin, ['SOSA, PEDRO', 'NADIE, RARO']);
    assert.equal(sin.includes('ACOSTA, JULIO'), false);
    assert.equal(g.enPlataforma.some((x) => g.paraAlta.some((a) => a.fila.indice === x.fila.indice)), false);
    const filas = [
      peg({ indice: 0, nombre: 'PEREZ, JUAN' }),
      peg({ indice: 1, nombre: 'ACOSTA, JULIO' }),
      peg({ indice: 2, nombre: 'NADIE, RARO' }),
    ];
    const malContadas = sinEncontrarVisibles(filas, indicesAsignados({ 0: 2, 1: null, 2: null }), new Set([1]));
    assert.deepEqual(malContadas, ['NADIE, RARO']);
  });

  it('el lugar es cliente · objetivo del mes, o sin objetivo asignado', () => {
    const objetivos: ObjetivoCatalogo[] = [
      { id: 'obj_padron', nombre: 'Objetivo Prueba', cliente: 'Cliente Prueba' },
      { id: 'obj_ruta', nombre: 'Peaje Norte', cliente: 'Cliente Ruta' },
    ];
    const turnos = [
      { employeeId: 'acosta', objectiveId: 'obj_ruta', date: '2026-10-01' },
      { employeeId: 'acosta', objectiveId: 'obj_ruta', date: '2026-10-02' },
      { employeeId: 'acosta', objectiveId: 'obj_padron', date: '2026-09-30' },
      { employeeId: 'mixto', objectiveId: 'obj_padron', date: '2026-10-01' },
      { employeeId: 'mixto', objectiveId: 'obj_ruta', date: '2026-10-02' },
      { employeeId: 'mixto', objectiveId: 'obj_ruta', date: '2026-10-03' },
    ];
    assert.equal(lugarDeGuardia({
      employeeId: 'acosta', preferredObjectiveId: '', month: '2026-10', turnos, objetivos,
    }), 'Cliente Ruta · Peaje Norte');
    assert.equal(lugarDeGuardia({
      employeeId: 'vacio', preferredObjectiveId: '', month: '2026-10', turnos, objetivos,
    }), 'sin objetivo asignado');
    assert.equal(lugarDeGuardia({
      employeeId: 'vacio', preferredObjectiveId: 'obj_padron', month: '2026-10', turnos: [], objetivos,
    }), 'Cliente Prueba · Objetivo Prueba');
    assert.equal(lugarDeGuardia({
      employeeId: 'mixto', preferredObjectiveId: 'obj_padron', month: '2026-10', turnos, objetivos,
    }), 'Cliente Ruta · Peaje Norte');
    assert.equal(lugarDeGuardia({
      employeeId: 'roto', preferredObjectiveId: 'no-existe', month: '2026-10', turnos: [], objetivos,
    }), 'sin objetivo asignado');
    assert.equal(
      textoPlataforma({ id: 'a', nombre: 'ACOSTA, JULIO', legajo: '2001', objetivoNombre: 'Desconocido' }),
      'ACOSTA, JULIO (legajo 2001) · está en sin objetivo asignado',
    );
    assert.equal(
      textoPlataforma({ id: 'a', nombre: 'ACOSTA, JULIO', legajo: '2001', objetivoNombre: 'Cliente Ruta · Peaje Norte' }),
      'ACOSTA, JULIO (legajo 2001) · está en Cliente Ruta · Peaje Norte',
    );
  });
});

describe('definir un código', () => {
  it('FT/N es franco trabajado en la N y se aplica a todas las celdas de esa sigla', () => {
    const p = proponerDefinicion('FT/N');
    assert.equal(p.vaciar, false);
    assert.deepEqual(p.partes.map((x) => x.tipo === 'otro_objetivo' ? x.etiqueta : x.code), ['FT', 'N']);
    const eq = equivalenciaDeDefinicion('FT/N', p);
    assert.equal(eq.code, 'FT');
    assert.equal(yaDefinido('FT/N', []), false);
    assert.equal(yaDefinido('ft/n', [eq]), true);
  });

  it('VF/T se deja vacío y se recuerda como otro objetivo', () => {
    const p = proponerDefinicion('VF/T');
    assert.equal(p.vaciar, true);
    assert.match(p.nota, /Vifood/);
    assert.equal(textoCeldasVacias('VF/T', 6, 'Vifood'), 'Se dejan vacías 6 celdas: trabajan en otro objetivo (VF/T → Vifood)');
    for (const t of ['BANCO', 'STOCK', 'DECAT', 'MISE 2/T', 'PM / T']) {
      assert.equal(proponerDefinicion(t).vaciar, true, t);
    }
  });
});

describe('selección libre', () => {
  const dims = { filas: 10, cols: 31 };
  it('la diagonal baja a la derecha y a la izquierda', () => {
    assert.deepEqual(diagonal({ r: 0, c: 5 }, { r: 3, c: 8 }, dims), [
      { r: 0, c: 5 }, { r: 1, c: 6 }, { r: 2, c: 7 }, { r: 3, c: 8 },
    ]);
    assert.deepEqual(diagonal({ r: 0, c: 8 }, { r: 2, c: 6 }, dims).map((c) => c.c), [8, 7, 6]);
  });
  it('agrega y quita celdas sueltas, y pega la misma forma', () => {
    const una = alternarCelda([], { r: 1, c: 2 });
    const dos = alternarCelda(una, { r: 4, c: 9 });
    assert.equal(alternarCelda(dos, { r: 1, c: 2 }).length, 1);
    const pegado = pegarForma(dos, ['M', 'N'], { r: 2, c: 3 }, dims);
    assert.deepEqual(pegado, [
      { r: 2, c: 3, valor: 'M' },
      { r: 5, c: 10, valor: 'N' },
    ]);
  });
});

describe('horarios del pegado', () => {
  it('guarda el horario editable y propone actualizar el servicio si difiere', () => {
    const tabla = tablaCodigosPlanilla(
      [{ sigla: 'M' }, { sigla: 'T' }, { sigla: 'N' }],
      null,
      [
        { code: 'M', startTime: '07:00', endTime: '15:00' },
        { code: 'T', startTime: '15:00', endTime: '23:00' },
        { code: 'N', startTime: '23:00', endTime: '07:00' },
      ],
    );
    const editada = tabla.map((f) => f.sigla === 'M' ? { ...f, inicio: '06:00', fin: '14:00', difiereServicio: true } : f);
    const cambios = cambiosHorarioServicio(editada);
    assert.equal(cambios.length, 1);
    assert.equal(cambios[0].antes, '07:00–15:00');
    assert.equal(cambios[0].despues, '06:00–14:00');
    assert.match(textoFueraDeServicio(editada[0]), /Fuera del servicio/);
  });

  it('06–14 / 14–22 / 22–06 cierra por bandas y por horas', () => {
    const turnos = [
      { empId: 'a', nombre: 'A', code: 'M', startTime: '06:00', hours: 8, positionName: 'Puesto 1' },
      { empId: 'b', nombre: 'B', code: 'T', startTime: '14:00', hours: 8, positionName: 'Puesto 1' },
      { empId: 'c', nombre: 'C', code: 'N', startTime: '22:00', hours: 8, positionName: 'Puesto 1' },
    ];
    const r = puesto24Cerrado(turnos);
    assert.equal(r.porBandas, true);
    assert.equal(r.porHoras, true);
    const sinNoche = puesto24Cerrado(turnos.slice(0, 2));
    assert.equal(sinNoche.cerrado, false);
  });
});

describe('definir a mano un código del pegado', () => {
  const puestos = [
    { positionName: 'Puesto 1', shifts: [{ code: 'M', startTime: '08:00', endTime: '15:00' }] },
    { positionName: 'Puesto 2', shifts: [{ code: 'M', startTime: '10:00', endTime: '16:00' }] },
  ];
  it('propone puesto, turno y horario', () => {
    assert.deepEqual(proponerPuestoYBanda('P2 M', puestos), { puesto: 'Puesto 2', code: 'M', inicio: '10:00', fin: '16:00', faltaEnServicio: false });
    assert.deepEqual(proponerPuestoYBanda('P2 T', puestos), { puesto: 'Puesto 2', code: 'T', inicio: '15:00', fin: '23:00', faltaEnServicio: true });
    assert.deepEqual(proponerPuestoYBanda('P5T', puestos), { puesto: 'Puesto 5', code: 'T', inicio: '15:00', fin: '23:00', faltaEnServicio: true });
    assert.deepEqual(proponerPuestoYBanda('C', puestos), { puesto: 'Cortina', code: 'C', inicio: '07:00', fin: '15:00', faltaEnServicio: true });
  });
  it('suma al servicio solo lo que falta', () => {
    const res = agregarFranjasAPosiciones(
      [{ id: 'p1', name: 'Puesto 1', allowedShiftTypes: [{ code: 'M', startTime: '08:00', endTime: '15:00' }] }],
      [
        { puesto: 'Puesto 1', code: 'M', inicio: '08:00', fin: '15:00' },
        { puesto: 'Puesto 1', code: 'T', inicio: '15:00', fin: '22:00' },
        { puesto: 'Cortina', code: 'C', inicio: '07:00', fin: '15:00' },
      ],
    );
    assert.deepEqual(res?.agregadas, ['Puesto 1 · T 15:00–22:00', 'Cortina · C 07:00–15:00']);
    assert.equal(res?.positions.length, 2);
    assert.equal(res?.positions[0].allowedShiftTypes?.length, 2);
    assert.equal(agregarFranjasAPosiciones([{ name: 'Puesto 1', allowedShiftTypes: [{ code: 'M' }] }], [{ puesto: 'Puesto 1', code: 'M', inicio: '08:00', fin: '15:00' }]), null);
  });
  it('la equivalencia guarda el puesto', () => {
    const eq = equivalenciaManual('P2 T', { puesto: 'Puesto 2', code: 'T', inicio: '16:00', fin: '22:00' });
    assert.equal(eq.clave, 'P2T|none');
    assert.equal(eq.positionName, 'Puesto 2');
    assert.equal(equivalenciaOtroObjetivo('VF').otroObjetivo, 'Vifood');
  });
});
