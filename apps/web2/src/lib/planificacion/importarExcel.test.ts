import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bloquesDeCuadros,
  claseDeEstilo,
  compararServicio,
  cruzarGuardias,
  detectarCuadros,
  faltanEnPlanilla,
  proponerDestino,
  proponerDestinos,
  proponerRegla,
  proponerReglas,
  ajustarReglasAlServicio,
  conDoceEn24h,
  puestoDeTexto,
  resolverDestino,
  resumenPreview,
  sugerirCuadros,
  vistaPrevia,
  armarOrdenFilasPlanilla,
  ordenIdsPlanilla,
  ordenTrasPlanilla,
  type CeldaPlano,
  type CruceFila,
  type CuadroPlanilla,
  type EmpleadoCruce,
  type FilaPlanilla,
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

  it('propone el objetivo por el archivo y el título del cuadro', () => {
    const objetivos = [
      { id: 't', nombre: 'Tadicor', clienteId: 'c1', clienteNombre: 'Cliente' },
      { id: 'ta', nombre: 'Tadicor Anexo', clienteId: 'c1', clienteNombre: 'Cliente' },
      { id: 'cm', nombre: 'Casa Matriz / Centro Cultural', clienteId: 'b', clienteNombre: 'Banco' },
      { id: 'casa', nombre: 'Casa Mc Donalds', clienteId: 'x', clienteNombre: 'Otro' },
      { id: 'nec', nombre: 'Nuevo Edificio Corporativo', clienteId: 'b', clienteNombre: 'Banco' },
      { id: 'cor', nombre: 'Corblock', clienteId: 'a', clienteNombre: 'A' },
    ];
    const tadicor = proponerDestino(['A. TADICOR OCTUBRE.xlsx'], objetivos);
    assert.equal(tadicor?.nombre, 'Tadicor');
    assert.equal(tadicor?.confianza, 100);
    assert.match(tadicor?.motivo || '', /TADICOR/);
    assert.equal(proponerDestinos(['A. TADICOR OCTUBRE.xlsx'], objetivos)[1]?.nombre, 'Tadicor Anexo');

    const matriz = proponerDestino(['BANCO-CASA MATRIZ OCTUBRE.xlsx'], objetivos);
    assert.equal(matriz?.nombre, 'Casa Matriz / Centro Cultural');
    assert.equal(matriz?.confianza, 84);
    assert.match(matriz?.motivo || '', /CASA MATRIZ/);
    assert.ok((matriz?.confianza || 0) > (proponerDestinos(['BANCO-CASA MATRIZ OCTUBRE.xlsx'], objetivos).find((p) => p.objectiveId === 'casa')?.confianza || 0));
    assert.equal(proponerDestino(['BANCO-CASA MATRIZ OCTUBRE.xlsx', 'MUSEO'], objetivos)?.nombre, 'Casa Matriz / Centro Cultural');

    assert.equal(proponerDestino(['BANCO-NVO EDIFICIO CORPORATIVO OCTUBRE.xlsx'], objetivos)?.nombre, 'Nuevo Edificio Corporativo');
    assert.equal(proponerDestino(['A. CORBLOCK OCTUBRE.xlsx'], objetivos)?.nombre, 'Corblock');
    assert.equal(proponerDestino(['ZZZ SIN NOMBRE.xlsx'], objetivos), null);
  });

  it('una sucursal distinta por fila es un destino; los puestos cortos siguen en un cuadro', () => {
    const cuadro = (indice: number, puestos: string[]): CuadroPlanilla => ({
      indice, titulo: 'Interior', letras: '', avisoMes: null, referencias: [], avisos: [],
      filas: puestos.map((puesto, i) => ({ fila: i + 1, nombre: `PEREZ ${i}`, legajo: '', puesto, celdas: [] })),
    });
    assert.equal(bloquesDeCuadros([cuadro(0, ['Puesto 1', 'Puesto 2', 'Puesto 1'])]).length, 1);
    const largos = ['Sucursal Alfa Poniente Larga', 'Sucursal Beta Naciente Larga', 'Sucursal Gamma Austral Larga'];
    const bloques = bloquesDeCuadros([cuadro(1, largos)]);
    assert.equal(bloques.length, 3);
    assert.equal(bloques[0].etiqueta, largos[0]);
    assert.equal(bloques[0].filas[0].puesto, '');
    const alfa = proponerDestino(['BANCOS SEDES.xlsx', bloques[0].etiqueta], [
      { id: 'a', nombre: 'Alfa Poniente', clienteId: 'b', clienteNombre: 'Banco' },
      { id: 'g', nombre: 'Gamma Austral', clienteId: 'b', clienteNombre: 'Banco' },
    ]);
    assert.equal(alfa?.objectiveId, 'a');
  });

  it('los cuadros del mismo personal son versiones y se queda el último', () => {
    const fila = (nombre: string) => ({ fila: 1, nombre, legajo: '', puesto: '', celdas: [] });
    const cuadro = (nombres: string[]): Parameters<typeof sugerirCuadros>[0][number] => ({
      indice: 0, titulo: '', letras: 'JV', avisoMes: null, referencias: [], avisos: [], filas: nombres.map(fila),
    });
    assert.deepEqual(sugerirCuadros([cuadro(['PEREZ JUAN', 'GOMEZ ANA']), cuadro(['PEREZ JUAN', 'GOMEZ ANA'])]), [1]);
    assert.deepEqual(sugerirCuadros([cuadro(['PEREZ JUAN']), cuadro(['GOMEZ ANA'])]), [0, 1]);
    const conDias = (n: number) => ({
      indice: 0, titulo: '', letras: 'JV', avisoMes: null, referencias: [], avisos: [],
      filas: [{ fila: 1, nombre: 'PEREZ JUAN', legajo: '', puesto: '', celdas: Array.from({ length: n }, (_, i) => ({ dia: i + 1, raw: 'M', color: 'none' as const })) }],
    });
    assert.deepEqual(sugerirCuadros([conDias(31), conDias(5)]), [0]);
  });

  it('Casino: «* REFERENCIAS *» con el horario abajo, MG/TG/NG van al turno del servicio con ese horario y puesto', () => {
    const celdas: CeldaPlano[] = [];
    const put = (fila: number, col: number, valor: string | number, color = 'none') => celdas.push({ fila, col, valor, color } as CeldaPlano);
    for (let d = 1; d <= 31; d++) put(1, 2 + d, d);
    const fila = (f: number, nombre: string, codigos: string[]) => {
      put(f, 1, nombre);
      codigos.forEach((c, i) => put(f, 3 + i, c, c === 'Mr' ? 'red' : 'none'));
    };
    fila(2, 'BAEZ AUGUSTO', Array.from({ length: 31 }, (_, i) => ['MG', 'TG', 'NG', 'N', 'MD', 'F', 'F'][i % 7]));
    fila(3, 'LEON FELISA', Array.from({ length: 31 }, (_, i) => ['N', 'N', 'MD', 'MD', 'F', 'F', 'MG'][i % 7]));
    put(4, 1, '* REFERENCIAS *');
    [['MG', 'MAÑANA GUARDIA', '7 A 15'], ['MD', 'MEDIODIA', '13 A 21'], ['TG', 'TARDE GUARDIA', '15 A 23'], ['N', 'NOCHE', '21 A 05'], ['NG', 'NOCHE GUARDIA', '23 A 7']]
      .forEach(([c, d, h], i) => { put(4, 3 + i * 4, c); put(4, 4 + i * 4, d); put(5, 4 + i * 4, h); });
    const [cuadro] = detectarCuadros(celdas, 2026, 10);
    assert.deepEqual(cuadro.filas.map((f) => f.nombre), ['BAEZ AUGUSTO', 'LEON FELISA']);
    assert.ok(cuadro.referencias.some((r) => r.codigo === 'MG' && r.inicio === '07:00' && r.fin === '15:00'));
    const turnos: TurnoServicio[] = [
      { positionName: 'Guardia', code: 'M', startTime: '07:00', endTime: '15:00' },
      { positionName: 'Guardia', code: 'T', startTime: '15:00', endTime: '23:00' },
      { positionName: 'Guardia', code: 'N', startTime: '23:00', endTime: '07:00' },
      { positionName: 'Mediodia', code: 'MD', startTime: '13:00', endTime: '21:00' },
      { positionName: 'Noche', code: 'N', startTime: '21:00', endTime: '05:00' },
    ];
    const reglas = ajustarReglasAlServicio(proponerReglas(cuadro), cuadro.referencias, turnos);
    const de = (c: string) => reglas.find((r) => r.codigo === c)!;
    assert.deepEqual([de('MG').code, de('MG').puesto], ['M', 'Guardia']);
    assert.deepEqual([de('TG').code, de('TG').puesto], ['T', 'Guardia']);
    assert.deepEqual([de('NG').code, de('NG').puesto], ['N', 'Guardia']);
    assert.deepEqual([de('N').code, de('N').puesto], ['N', 'Noche']);
    assert.deepEqual([de('MD').code, de('MD').puesto], ['MD', 'Mediodia']);
    const d = resolverDestino(de('N'), 'Guardia', turnos, cuadro.referencias);
    assert.deepEqual([d.positionName, d.startTime, d.endTime], ['Noche', '21:00', '05:00']);
  });

  it('licencias escritas en la planilla: médica → E, «LICENCIA X 14 DIAS» → V', () => {
    assert.equal(proponerRegla('LICENCIA MEDICA', 'none', []).code, 'E');
    assert.equal(proponerRegla('LICENCIA X 14 DIAS 2026', 'none', []).code, 'V');
  });

  it('Casino: Guardia de 24 h sin D12/N12 en el servicio → la M roja (07 a 19) es D12 y la T roja (19 a 07) es N12 de Guardia', () => {
    const turnos: TurnoServicio[] = [
      { positionName: 'Guardia', code: 'M', startTime: '07:00', endTime: '15:00' },
      { positionName: 'Guardia', code: 'T', startTime: '15:00', endTime: '23:00' },
      { positionName: 'Guardia', code: 'N', startTime: '23:00', endTime: '07:00' },
      { positionName: 'MM', code: 'M', startTime: '13:00', endTime: '21:00' },
    ];
    assert.deepEqual(conDoceEn24h(turnos).filter((t) => t.positionName === 'Guardia' && t.code.endsWith('12')).map((t) => `${t.code} ${t.startTime}-${t.endTime}`), ['D12 07:00-19:00', 'N12 19:00-07:00']);
    assert.equal(conDoceEn24h(turnos).filter((t) => t.positionName === 'MM').length, 1);
    const refs = [
      { codigo: 'M', desc: '07 A 19', inicio: '07:00', fin: '19:00', horas: 12, color: 'red' as const },
      { codigo: 'T', desc: '19 A 07', inicio: '19:00', fin: '07:00', horas: 12, color: 'red' as const },
    ];
    const reglas = ajustarReglasAlServicio([
      { clave: 'M|red', codigo: 'M', color: 'red', muestras: 3, ...proponerRegla('M', 'red', refs) } as any,
      { clave: 'T|red', codigo: 'T', color: 'red', muestras: 3, ...proponerRegla('T', 'red', refs) } as any,
    ], refs, turnos);
    assert.deepEqual(reglas.map((r) => `${r.code} · ${r.puesto}`), ['D12 · Guardia', 'N12 · Guardia']);
    const d = resolverDestino(reglas[1], 'MM', turnos, refs);
    assert.deepEqual([d.code, d.positionName, d.startTime, d.endTime], ['N12', 'Guardia', '19:00', '07:00']);
  });

  it('Claret: N de 9 h y NE no se reemplazan por N12 19–07', () => {
    const turnos: TurnoServicio[] = [
      { positionName: 'Vigilancia', code: 'M', startTime: '07:00', endTime: '15:00' },
      { positionName: 'Vigilancia', code: 'T', startTime: '15:00', endTime: '23:00' },
      { positionName: 'Vigilancia', code: 'N', startTime: '23:00', endTime: '08:00' },
      { positionName: 'Vigilancia', code: 'NE', startTime: '23:00', endTime: '08:00' },
    ];
    assert.equal(conDoceEn24h(turnos).some((t) => t.code === 'N12' || t.code === 'D12'), false);
    const red = { clave: 'N|red', codigo: 'N', color: 'red' as const, muestras: 4, accion: 'doce' as const, code: 'N', nota: '' };
    const d = resolverDestino(red, 'Vigilancia', turnos, []);
    assert.equal(d.code, 'N');
    assert.equal(d.startTime, '23:00');
    assert.equal(d.endTime, '08:00');
    assert.equal(d.hours, 9);
    const ne = resolverDestino(
      { clave: 'NE|none', codigo: 'NE', color: 'none', muestras: 2, accion: 'turno', code: 'NE', nota: '' },
      'Vigilancia', turnos, [],
    );
    assert.equal(ne.code, 'NE');
    assert.equal(ne.endTime, '08:00');
    assert.equal(ne.hours, 9);
    const soloCatalogo = resolverDestino(
      { clave: 'MA|none', codigo: 'MA', color: 'none', muestras: 1, accion: 'turno', code: 'MA', nota: '' },
      'Vigilancia', [], [],
      [{ code: 'MA', startTime: '07:00', endTime: '16:00' }],
    );
    assert.equal(soloCatalogo.startTime, '07:00');
    assert.equal(soloCatalogo.endTime, '16:00');
    assert.equal(proponerRegla('NE', 'none', [], [{ code: 'NE', startTime: '23:00', endTime: '08:00' }]).accion, 'turno');
  });

  it('el orden de filas sigue la planilla y deja al final a quien no viene', () => {
    const fila = (n: number, nombre: string): FilaPlanilla => ({ fila: n, nombre, legajo: '', puesto: '', celdas: [] });
    const cruce: CruceFila[] = [
      { fila: 12, nombrePlanilla: 'B', legajo: '', estado: 'encontrado', employeeId: 'b', nota: '', candidatos: [] },
      { fila: 9, nombrePlanilla: 'A', legajo: '', estado: 'encontrado', employeeId: 'a', nota: '', candidatos: [] },
      { fila: 10, nombrePlanilla: 'X', legajo: '', estado: 'no', employeeId: null, nota: '', candidatos: [] },
      { fila: 11, nombrePlanilla: 'A2', legajo: '', estado: 'encontrado', employeeId: 'a', nota: '', candidatos: [] },
      { fila: 8, nombrePlanilla: 'Nuevo', legajo: '', estado: 'encontrado', employeeId: 'n', nota: '', candidatos: [] },
    ];
    assert.deepEqual(ordenIdsPlanilla([fila(12, 'B'), fila(9, 'A'), fila(10, 'X'), fila(11, 'A2'), fila(8, 'Nuevo')], cruce), ['n', 'a', 'b']);
    assert.deepEqual(armarOrdenFilasPlanilla(['a', 'b', 'c', 'd'], ['b', 'n', 'b', '']), ['b', 'n', 'a', 'c', 'd']);

    const objetivo = ordenTrasPlanilla({
      ordenPorClave: { obj: ['a', 'b', 'c'] },
      idsPlanilla: ['c', 'a'],
      idsAcumuladosGrupo: [],
      objectiveId: 'obj',
      claveVisible: 'obj',
      idsVisibles: ['a', 'b', 'c'],
      vistaAgrupada: false,
      idsGrupo: [],
      clavesYaActualizadas: [],
    });
    assert.deepEqual(objetivo.ordenPorClave.obj, ['c', 'a', 'b']);

    const grupo = ordenTrasPlanilla({
      ordenPorClave: {},
      idsPlanilla: ['p', 'q'],
      idsAcumuladosGrupo: [],
      objectiveId: 'obj2',
      claveVisible: 'obj1',
      idsVisibles: ['a', 'p', 'b', 'q'],
      vistaAgrupada: true,
      idsGrupo: ['obj1', 'obj2'],
      clavesYaActualizadas: [],
    });
    assert.deepEqual(grupo.ordenPorClave.obj1, ['p', 'q', 'a', 'b']);
    assert.deepEqual(grupo.ordenPorClave.obj2, ['p', 'q', 'a', 'b']);

    const segundo = ordenTrasPlanilla({
      ordenPorClave: grupo.ordenPorClave,
      idsPlanilla: ['b', 'z'],
      idsAcumuladosGrupo: grupo.idsAcumuladosGrupo,
      objectiveId: 'obj1',
      claveVisible: 'obj2',
      idsVisibles: ['p', 'q'],
      vistaAgrupada: false,
      idsGrupo: ['obj1', 'obj2'],
      clavesYaActualizadas: [],
    });
    assert.deepEqual(segundo.ordenPorClave.obj1, ['p', 'q', 'b', 'z', 'a']);
    assert.deepEqual(segundo.ordenPorClave.obj2, ['p', 'q', 'a', 'b']);
  });
});

