import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  claseDeEstilo,
  compararServicio,
  cruzarGuardias,
  detectarCuadros,
  faltanEnPlanilla,
  proponerRegla,
  proponerReglas,
  puestoDeTexto,
  resolverDestino,
  resumenPreview,
  sugerirCuadros,
  vistaPrevia,
  type CeldaPlano,
  type EmpleadoCruce,
  type TurnoServicio,
} from './importarExcel';

const SLA: TurnoServicio[] = [
  { positionName: 'Puesto 1', code: 'M', startTime: '07:00', endTime: '15:00', quantity: 1 },
  { positionName: 'Puesto 1', code: 'T', startTime: '15:00', endTime: '23:00', quantity: 1 },
  { positionName: 'Puesto 1', code: 'N', startTime: '23:00', endTime: '07:00', quantity: 1 },
  { positionName: 'Puesto 1', code: 'D12', startTime: '07:00', endTime: '19:00', quantity: 1 },
  { positionName: 'Puesto 1', code: 'N12', startTime: '19:00', endTime: '07:00', quantity: 1 },
  { positionName: 'Museo', code: 'MM', startTime: '08:00', endTime: '17:00', quantity: 1 },
  { positionName: 'Museo', code: 'ME', startTime: '07:00', endTime: '19:00', quantity: 1 },
];

/** Octubre 2026 arranca jueves (J) y viernes (V). */
function grillaOctubre(): CeldaPlano[] {
  const celdas: CeldaPlano[] = [
    { fila: 4, col: 1, valor: 'BACAR', color: 'none' },
    { fila: 4, col: 7, valor: 'CORBLOCK', color: 'none' },
  ];
  const letras = ['J', 'V', 'S', 'D', 'L', 'M', 'M', 'J', 'V', 'S', 'D', 'L', 'M', 'M', 'J', 'V', 'S', 'D', 'L', 'M', 'M', 'J', 'V', 'S', 'D', 'L', 'M', 'M', 'J', 'V', 'S'];
  for (let d = 1; d <= 31; d++) {
    celdas.push({ fila: 6, col: 6 + d, valor: letras[d - 1], color: 'none' });
    celdas.push({ fila: 7, col: 6 + d, valor: d, color: 'none' });
  }
  const fila = (f: number, nombre: string, legajo: number, puesto: string, codigos: Array<[string, 'none' | 'red']>) => {
    celdas.push({ fila: f, col: 1, valor: nombre, color: 'none' });
    celdas.push({ fila: f, col: 5, valor: legajo, color: 'none' });
    celdas.push({ fila: f, col: 6, valor: puesto, color: 'none' });
    codigos.forEach(([raw, color], i) => celdas.push({ fila: f, col: 7 + i, valor: raw, color }));
  };
  const mes = (code: string, n: number, color: 'none' | 'red' = 'none') => Array.from({ length: n }, () => [code, color] as [string, 'none' | 'red']);
  fila(8, 'PEREZ JUAN', 1001, 'Puesto 1', [...mes('M', 6), ...mes('F', 2), ...mes('M', 1, 'red'), ...mes('T', 5)]);
  fila(9, 'GOMEZ ANA', 1002, 'Museo', [...mes('MM', 5), ...mes('M', 1, 'red'), ...mes('F', 2)]);
  fila(10, 'NADIE AUSENTE', 9999, 'Puesto 1', [...mes('ART', 2), ...mes('VAC', 1), ...mes('SUSPENSION', 1), ...mes('RETEN', 1), ...mes('CM', 1)]);
  celdas.push({ fila: 12, col: 1, valor: 'REFERENCIAS', color: 'none' });
  celdas.push({ fila: 12, col: 9, valor: 'M', color: 'none' });
  celdas.push({ fila: 12, col: 10, valor: 'Mañana', color: 'none' });
  celdas.push({ fila: 12, col: 13, valor: 'T', color: 'none' });
  celdas.push({ fila: 12, col: 14, valor: 'Tarde', color: 'none' });
  celdas.push({ fila: 13, col: 10, valor: '07 a 15 hs', color: 'none' });
  celdas.push({ fila: 13, col: 14, valor: '15 a 23 hs', color: 'none' });
  celdas.push({ fila: 12, col: 20, valor: 'M', color: 'red' });
  celdas.push({ fila: 12, col: 21, valor: 'Mañana', color: 'none' });
  celdas.push({ fila: 13, col: 21, valor: '07 a 19', color: 'none' });
  return celdas;
}

const EMPLEADOS: EmpleadoCruce[] = [
  { id: 'e1', nombre: 'PEREZ, Juan', legajo: '1001', empresaId: 'pruebas_sa', objetivoPreferido: 'obj' },
  { id: 'e2', nombre: 'GOMEZ, Ana Maria', legajo: '1002', empresaId: 'pruebas_sa', objetivoPreferido: 'obj' },
  { id: 'e3', nombre: 'LOPEZ, Mario', legajo: '1003', empresaId: 'pruebas_sa', objetivoPreferido: 'obj' },
  { id: 'e4', nombre: 'LOPEZ, Marta', legajo: '1004', empresaId: 'pruebas_sa' },
  { id: 'e5', nombre: 'SOSA, Pedro', legajo: '8888', empresaId: 'pruebas_sa' },
];

describe('importar planilla', () => {
  it('el rojo de relleno es jornada marcada y el negro de tema no', () => {
    assert.equal(claseDeEstilo({ patternType: 'solid', fgColor: { rgb: 'FFFF0000' } }), 'red');
    assert.equal(claseDeEstilo({ patternType: 'solid', fgColor: { theme: 1, rgb: '000000' } }), 'none');
    assert.equal(claseDeEstilo(null), 'none');
  });

  it('detecta la grilla, el legajo, el puesto y las referencias', () => {
    const [c] = detectarCuadros(grillaOctubre(), 2026, 10);
    assert.equal(c.titulo, 'CORBLOCK');
    assert.equal(c.letras, 'JV');
    assert.equal(c.avisoMes, null);
    assert.equal(c.filas.length, 3);
    assert.equal(c.filas[0].legajo, '1001');
    assert.equal(c.filas[0].puesto, 'Puesto 1');
    assert.equal(c.filas[0].celdas[0].raw, 'M');
    const manana = c.referencias.find((r) => r.codigo === 'M' && r.color !== 'red');
    assert.equal(manana?.inicio, '07:00');
    assert.equal(manana?.fin, '15:00');
    const roja = c.referencias.find((r) => r.codigo === 'M' && r.color === 'red');
    assert.equal(roja?.inicio, '07:00');
    assert.equal(roja?.fin, '19:00');
  });

  it('avisa si las letras no son las del mes', () => {
    const celdas = grillaOctubre().map((c) => (c.fila === 6 && c.col === 7 ? { ...c, valor: 'L' } : c));
    const [c] = detectarCuadros(celdas, 2026, 10);
    assert.match(c.avisoMes || '', /copia de otro mes/);
  });

  it('propone el mapeo común y la celda roja como 12 h', () => {
    assert.equal(proponerRegla('RETEN', 'none', []).accion, 'ret');
    assert.equal(proponerRegla('F', 'none', []).code, 'F');
    assert.equal(proponerRegla('ART', 'rgb:FFFF00', []).code, 'A');
    assert.equal(proponerRegla('CM', 'rgb:FFC000', []).code, 'E');
    assert.equal(proponerRegla('VAC', 'none', []).code, 'V');
    assert.equal(proponerRegla('LIC ANUAL', 'none', []).code, 'V');
    assert.equal(proponerRegla('SUSPENSION', 'none', []).code, 'SUS');
    assert.equal(proponerRegla('M', 'red', []).accion, 'doce');
    assert.equal(proponerRegla('BANCO MACRO', 'none', []).accion, 'ignorar');
  });

  it('la roja del puesto 24 h es D12 y la del museo es ME', () => {
    const [cuadro] = detectarCuadros(grillaOctubre(), 2026, 10);
    const reglas = proponerReglas(cuadro);
    const items = vistaPrevia({
      year: 2026, month: 10, cuadro, reglas,
      cruce: cruzarGuardias(cuadro.filas, EMPLEADOS, 'pruebas_sa'),
      incluirDudosos: true, turnos: SLA, actuales: [],
    });
    const perezRoja = items.find((i) => i.employeeId === 'e1' && i.dia === 9);
    assert.equal(perezRoja?.destino.code, 'D12');
    assert.equal(perezRoja?.destino.positionName, 'Puesto 1');
    const gomezRoja = items.find((i) => i.employeeId === 'e2' && i.dia === 6);
    assert.equal(gomezRoja?.destino.code, 'ME');
    assert.equal(gomezRoja?.destino.positionName, 'Museo');
  });

  it('cruza por legajo, marca dudoso y avisa quién falta en la planilla', () => {
    const [cuadro] = detectarCuadros(grillaOctubre(), 2026, 10);
    const filas = [
      ...cuadro.filas,
      { fila: 20, nombre: 'LOPEZ', legajo: '', puesto: '', celdas: [] },
    ];
    const cruce = cruzarGuardias(filas, EMPLEADOS, 'pruebas_sa');
    assert.equal(cruce.find((c) => c.legajo === '1001')?.estado, 'encontrado');
    assert.equal(cruce.find((c) => c.nombrePlanilla === 'LOPEZ')?.estado, 'dudoso');
    assert.equal(cruce.find((c) => c.legajo === '9999')?.estado, 'no');
    const enPlanilla = cruzarGuardias(cuadro.filas, EMPLEADOS, 'pruebas_sa');
    const faltan = faltanEnPlanilla(enPlanilla, EMPLEADOS.filter((e) => e.objetivoPreferido === 'obj'));
    assert.deepEqual(faltan.map((e) => e.id), ['e3']);
  });

  it('la vista previa separa nuevas, cambios, iguales y licencias', () => {
    const [cuadro] = detectarCuadros(grillaOctubre(), 2026, 10);
    const reglas = proponerReglas(cuadro);
    const cruce = cruzarGuardias(cuadro.filas, EMPLEADOS, 'pruebas_sa');
    const items = vistaPrevia({
      year: 2026, month: 10, cuadro, reglas, cruce, incluirDudosos: false, turnos: SLA,
      actuales: [
        { employeeId: 'e1', dateStr: '2026-10-01', code: 'M' },
        { employeeId: 'e1', dateStr: '2026-10-02', code: 'T' },
        { employeeId: 'e1', dateStr: '2026-10-03', code: 'V', licencia: true },
      ],
    });
    const res = resumenPreview(items);
    assert.equal(items.find((i) => i.dateStr === '2026-10-01')?.estado, 'igual');
    assert.equal(items.find((i) => i.dateStr === '2026-10-02')?.estado, 'cambia');
    assert.equal(items.find((i) => i.dateStr === '2026-10-03')?.estado, 'no_toca');
    assert.ok(res.nuevas > 0 && res.iguales === 1 && res.cambian >= 1 && res.noToca >= 1);
  });

  it('un mapeo guardado pisa la propuesta', () => {
    const [cuadro] = detectarCuadros(grillaOctubre(), 2026, 10);
    const reglas = proponerReglas(cuadro, [{
      clave: 'M|none', codigo: 'M', color: 'none', muestras: 0, accion: 'franco', code: 'F', nota: 'a mano',
    }]);
    assert.equal(reglas.find((r) => r.clave === 'M|none')?.accion, 'franco');
  });

  it('sin servicio lo dice; con el mismo horario coincide', () => {
    const [cuadro] = detectarCuadros(grillaOctubre(), 2026, 10);
    const reglas = proponerReglas(cuadro);
    assert.equal(compararServicio(cuadro, [], reglas).veredicto, 'sin_servicio');
    const soloPuesto = SLA.filter((t) => t.positionName === 'Puesto 1');
    const cmp = compararServicio({ ...cuadro, filas: cuadro.filas.filter((f) => f.puesto === 'Puesto 1') }, soloPuesto, reglas);
    assert.equal(cmp.veredicto, 'coincide');
  });

  it('M del puesto sin esa letra usa la banda de horario parecido', () => {
    const turnos: TurnoServicio[] = [
      { positionName: 'RECEPCION 1', code: 'R1', startTime: '07:00', endTime: '17:00', quantity: 1 },
      { positionName: 'RECEPCION', code: 'M', startTime: '07:00', endTime: '15:00', quantity: 1 },
      { positionName: 'BUNKER Y VIG FISICA', code: 'M1', startTime: '07:00', endTime: '17:00', quantity: 2 },
    ];
    const refs = [{ codigo: 'M', desc: 'Mañana', inicio: '07:00', fin: '15:00', horas: 8, color: 'none' as const }];
    const regla = { clave: 'M|none', codigo: 'M', color: 'none' as const, muestras: 1, accion: 'turno' as const, code: 'M', nota: '' };
    assert.equal(resolverDestino(regla, 'RECEPCION 1', turnos, refs).code, 'R1');
    assert.equal(resolverDestino(regla, 'RECEPCION', turnos, refs).code, 'M');
    assert.equal(puestoDeTexto('VIG. FISICA', turnos.map((t) => t.positionName)), 'BUNKER Y VIG FISICA');
    assert.equal(puestoDeTexto('RECEPCION 1', turnos.map((t) => t.positionName)), 'RECEPCION 1');
  });

  it('los cuadros del mismo personal son versiones y se queda el último', () => {
    const fila = (nombre: string) => ({ fila: 1, nombre, legajo: '', puesto: '', celdas: [] });
    const cuadro = (nombres: string[]): Parameters<typeof sugerirCuadros>[0][number] => ({
      indice: 0, titulo: '', letras: 'JV', avisoMes: null, referencias: [], avisos: [], filas: nombres.map(fila),
    });
    assert.deepEqual(sugerirCuadros([cuadro(['PEREZ JUAN', 'GOMEZ ANA']), cuadro(['PEREZ JUAN', 'GOMEZ ANA'])]), [1]);
    assert.deepEqual(sugerirCuadros([cuadro(['PEREZ JUAN']), cuadro(['GOMEZ ANA'])]), [0, 1]);
  });
});
