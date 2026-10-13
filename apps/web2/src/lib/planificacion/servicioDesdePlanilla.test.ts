import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectarCuadros, normPlanilla, type CeldaPlano } from './importarExcel';
import { prepararPegadoExcel } from './modoRapido';
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';
import {
  adoptarCodigoVigente,
  avisosFueraDeServicio,
  compararConVigente,
  equivalenciasAlCodigoServicio,
  type DiaSemana,
  type FranjaServicioPlanilla,
  emparejarPuestos,
  diasDeFechas,
  etiquetaDias,
  etiquetaFechas,
  franjasDesdeVigente,
  cubre24Horas,
  posicionesDesdeFranjas,
  letraDia,
  lineasConfirmacion,
  proponerServicioDesdePlanilla,
  proponerServicioDesdeTurnos,
} from './servicioDesdePlanilla';

/** Octubre 2026: el 1 es jueves. */
function planilla(filas: Array<{ nombre: string; puesto: string; celdas: Array<{ raw: string; color?: 'red' | 'none' } | null> }>, refs: CeldaPlano[] = []): CeldaPlano[] {
  const celdas: CeldaPlano[] = [
    { fila: 4, col: 7, valor: 'OBJETIVO PRUEBA', color: 'none' },
  ];
  for (let d = 1; d <= 31; d++) {
    celdas.push({ fila: 6, col: 6 + d, valor: letraDia(2026, 10, d) === 'X' ? 'M' : letraDia(2026, 10, d), color: 'none' });
    celdas.push({ fila: 7, col: 6 + d, valor: d, color: 'none' });
  }
  filas.forEach((f, i) => {
    const fila = 8 + i;
    celdas.push({ fila, col: 1, valor: f.nombre, color: 'none' });
    celdas.push({ fila, col: 5, valor: 2000 + i, color: 'none' });
    celdas.push({ fila, col: 6, valor: f.puesto, color: 'none' });
    f.celdas.forEach((c, d) => {
      if (!c) return;
      celdas.push({ fila, col: 7 + d, valor: c.raw, color: c.color || 'none' });
    });
  });
  celdas.push({ fila: 20, col: 1, valor: 'REFERENCIAS', color: 'none' });
  celdas.push({ fila: 20, col: 9, valor: 'M', color: 'none' });
  celdas.push({ fila: 20, col: 10, valor: 'Mañana', color: 'none' });
  celdas.push({ fila: 21, col: 10, valor: '07 a 15 hs', color: 'none' });
  celdas.push({ fila: 20, col: 13, valor: 'T', color: 'none' });
  celdas.push({ fila: 20, col: 14, valor: 'Tarde', color: 'none' });
  celdas.push({ fila: 21, col: 14, valor: '15 a 23 hs', color: 'none' });
  celdas.push({ fila: 20, col: 20, valor: 'M', color: 'red' });
  celdas.push({ fila: 20, col: 21, valor: 'Mañana 12', color: 'none' });
  celdas.push({ fila: 21, col: 21, valor: '07 a 19', color: 'none' });
  return celdas.concat(refs);
}

function mes(raw: string, pred: (letra: string) => boolean, color: 'red' | 'none' = 'none') {
  return Array.from({ length: 31 }, (_, i) => (pred(letraDia(2026, 10, i + 1)) ? { raw, color } : { raw: 'F', color: 'none' as const }));
}

const LV = (letra: string) => ['L', 'M', 'X', 'J', 'V'].includes(letra);

describe('servicio desde la planilla', () => {
  it('la moda por día arma L–V y el sábado con otra cantidad', () => {
    const a = mes('M', LV);
    const b = mes('M', LV);
    const sabado = Array.from({ length: 31 }, (_, i) => (letraDia(2026, 10, i + 1) === 'S' ? { raw: 'M' } : { raw: 'F' }));
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'PEREZ JUAN', puesto: 'Puesto 1', celdas: a },
      { nombre: 'GOMEZ ANA', puesto: 'Puesto 1', celdas: b },
      { nombre: 'LOPEZ MARIO', puesto: 'Puesto 1', celdas: sabado },
    ]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const lv = prop.franjas.find((f) => f.code === 'M' && etiquetaDias(f.dias) === 'L–V');
    const sab = prop.franjas.find((f) => f.code === 'M' && etiquetaDias(f.dias) === 'S');
    assert.ok(lv);
    assert.equal(lv?.cantidad, 2);
    assert.equal(lv?.startTime, '07:00');
    assert.equal(lv?.endTime, '15:00');
    assert.ok(sab);
    assert.equal(sab?.cantidad, 1);
    assert.equal(prop.franjas.some((f) => f.code === 'D12'), false);
  });

  it('la M roja repetida es D12 y una suelta no abre franja de 12 h', () => {
    const esquema = Array.from({ length: 31 }, (_, i) => {
      const letra = letraDia(2026, 10, i + 1);
      return LV(letra) ? { raw: 'M', color: 'red' as const } : { raw: 'F' };
    });
    const suelta = Array.from({ length: 31 }, (_, i) => (i === 0 ? { raw: 'M', color: 'red' as const } : { raw: 'T' }));
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'PEREZ JUAN', puesto: 'Planta', celdas: esquema },
      { nombre: 'GOMEZ ANA', puesto: 'Acceso', celdas: suelta },
    ]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const d12 = prop.franjas.find((f) => f.puesto === 'Planta' && f.code === 'D12');
    assert.ok(d12);
    assert.equal(d12?.startTime, '07:00');
    assert.equal(d12?.endTime, '19:00');
    assert.equal(etiquetaDias(d12?.dias || []), 'L–V');
    assert.equal(prop.franjas.some((f) => f.puesto === 'Acceso' && f.code === 'D12'), false);
    assert.ok(prop.franjas.some((f) => f.puesto === 'Acceso' && f.code === 'T'));
  });

  it('deja afuera franco, retén, licencia, refuerzo y evento', () => {
    const celdas = Array.from({ length: 31 }, (_, i) => {
      const codigos = ['F', 'RETEN', 'V', 'REF', 'EV', 'ART', 'M'];
      return { raw: codigos[i % codigos.length] };
    });
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'PEREZ JUAN', puesto: 'Puesto 1', celdas },
    ]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    assert.deepEqual(prop.franjas.map((f) => f.code), ['M']);
    assert.equal(prop.equivalencias.some((e) => e.codigo === 'M' && e.code === 'M'), true);
    assert.equal(prop.equivalencias.some((e) => e.codigo === 'RETEN' || e.codigo === 'V' || e.codigo === 'REF'), false);
  });

  it('marca coincide, distinto, falta y sobra contra el servicio vigente', () => {
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'PEREZ JUAN', puesto: 'Puesto 1', celdas: mes('M', LV) },
    ]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const diff = compararConVigente(prop.franjas, [
      { puesto: 'Puesto 1', code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: ['L', 'M', 'X', 'J', 'V'] },
      { puesto: 'Puesto 1', code: 'N', startTime: '23:00', endTime: '07:00', cantidad: 1, dias: [] },
    ]);
    assert.equal(diff.find((d) => d.code === 'M')?.estado, 'coincide');
    assert.equal(diff.find((d) => d.code === 'N')?.estado, 'sobra');
    const distinto = compararConVigente(prop.franjas, [
      { puesto: 'Puesto 1', code: 'M', startTime: '08:00', endTime: '16:00', cantidad: 2, dias: ['L', 'M', 'X', 'J', 'V', 'S'] },
    ]);
    assert.equal(distinto[0].estado, 'distinto');
    const lineas = lineasConfirmacion(distinto, 'actualizar', 'octubre 2026');
    assert.match(lineas[0], /aplicar estos cambios/);
    assert.match(lineas.join('\n'), /horario/);
  });

  it('empareja «Puesto» con «PUESTO 1» y «P2» con «Puesto 2»: sale «distinto horario», no falta + sobra', () => {
    const vig = [
      { puesto: 'PUESTO 1', code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: [] as string[] },
      { puesto: 'Puesto 2', code: 'T', startTime: '15:00', endTime: '23:00', cantidad: 1, dias: [] as string[] },
    ];
    const par = emparejarPuestos([{ puesto: 'Puesto', code: 'M' }, { puesto: 'P2', code: 'T' }], vig);
    assert.equal(par.get(normPlanilla('Puesto')), 'PUESTO 1');
    assert.equal(par.get(normPlanilla('P2')), 'Puesto 2');
    const diff = compararConVigente([
      { id: 'f1', puesto: 'Puesto', code: 'M', startTime: '06:00', endTime: '14:00', cantidad: 1, dias: [] },
    ], vig.slice(0, 1));
    assert.equal(diff.length, 1);
    assert.equal(diff[0].estado, 'distinto');
    assert.match(diff[0].detalle, /horario/);
  });

  it('con equivalencias el pegado usa el código del servicio y lista el que no está', () => {
    const eqs: EquivalenciaCodigo[] = [{
      clave: claveEquivalencia('M', true),
      codigo: 'M',
      color: 'red',
      code: 'D12',
      startTime: '07:00',
      endTime: '19:00',
      muestras: 4,
    }, {
      clave: claveEquivalencia('R1', false),
      codigo: 'R1',
      color: 'none',
      code: 'M',
      startTime: '06:00',
      endTime: '14:00',
      muestras: 2,
    }];
    const tsv = 'PEREZ JUAN\t1001\tPlanta\tR1\tZZ\tV\tF';
    const matriz = tsv.split('\n').map((l) => l.split('\t'));
    const colores = [[{ fondo: null, letra: null }, { fondo: null, letra: null }, { fondo: null, letra: null }, { fondo: null, letra: null }, { fondo: 'ROJO' as const, letra: null }, null, null]];
    const p = prepararPegadoExcel(matriz, {
      guardias: [{ fila: 0, nombre: 'PEREZ, Juan', legajo: '1001' }],
      cursor: null,
      cols: 31,
      conocidos: new Set(['M', 'T', 'N', 'D12', 'F', 'V', 'RET']),
      equivalencias: eqs,
      colores,
    });
    assert.equal(p.filas[0].celdas.map((c) => c.code).join(','), 'M,V,F');
    assert.deepEqual(p.desconocidos, ['ZZ']);
  });

  it('avisa código, horario y día fuera del servicio, sin bloquear', () => {
    const franjas = [{ positionName: 'Puesto 1', code: 'M', startTime: '07:00', endTime: '15:00', days: ['L', 'M', 'X', 'J', 'V'] }];
    const avisos = avisosFueraDeServicio({
      filas: [{ id: 'g1', nombre: 'PEREZ, Juan' }],
      claves: new Set(['g1_2026-10-01', 'g1_2026-10-03', 'g1_2026-10-05']),
      turnoDe: (_e, d) => {
        if (d === '2026-10-01') return { code: 'T', startTime: '15:00', endTime: '23:00', trabajo: true, positionName: 'Puesto 1' };
        if (d === '2026-10-03') return { code: 'M', startTime: '07:00', endTime: '15:00', trabajo: true, positionName: 'Puesto 1' };
        return { code: 'M', startTime: '08:00', endTime: '16:00', trabajo: true, positionName: 'Puesto 1' };
      },
      franjas,
    });
    assert.deepEqual(avisos.map((a) => a.code).sort(), ['CODIGO', 'DIA', 'HORARIO']);
    assert.match(avisos.find((a) => a.code === 'DIA')?.texto || '', /no está habilitado el S/);
  });

  it('arma la propuesta desde los turnos del mes y copia el mes anterior', () => {
    const turnos = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'].flatMap((dateStr) => ([
      { dateStr, positionName: 'Puesto 1', code: 'M', startTime: '06:00', endTime: '14:00' },
      { dateStr, positionName: 'RO', code: 'RO', startTime: '09:00', endTime: '13:00' },
    ]));
    turnos.push({ dateStr: '2026-10-01', positionName: 'Puesto 1', code: 'D12', startTime: '07:00', endTime: '19:00' });
    const prop = proponerServicioDesdeTurnos(turnos, 2026, 10);
    const m = prop.franjas.find((f) => f.puesto === 'Puesto 1' && f.code === 'M');
    assert.equal(m?.startTime, '06:00');
    assert.equal(m?.cantidad, 1);
    assert.ok(prop.franjas.some((f) => f.puesto === 'RO' && f.code === 'RO'));
    assert.equal(prop.franjas.some((f) => f.code === 'D12'), false);
    const copiadas = franjasDesdeVigente([{ puesto: 'Puesto 2', code: 'N', startTime: '22:00', endTime: '06:00', cantidad: 2, dias: ['L', 'M'] }]);
    assert.equal(copiadas[0].cantidad, 2);
    assert.deepEqual(copiadas[0].dias, ['L', 'M']);
    const diff = compararConVigente(copiadas, []);
    assert.equal(diff[0].estado, 'falta');
  });

  it('Tadicor: horario del puesto, todos los días en la rotación y el relevante no es puesto', () => {
    const ciclo = (offset: number, trabajo: string) => Array.from({ length: 31 }, (_, i) => (
      ((i + offset) % 8) < 6 ? { raw: trabajo } : { raw: 'F' }
    ));
    const cortina = Array.from({ length: 31 }, (_, i) => {
      const letra = letraDia(2026, 10, i + 1);
      if (letra === 'S') return { raw: 'C', color: 'rgb:92D050' as const };
      if (letra === 'D') return { raw: 'F' };
      return { raw: 'C' };
    });
    const relevante = Array.from({ length: 31 }, (_, i) => {
      const codigos = ['P1 M', 'P1 T', 'P2 M', 'P2 T', 'F'];
      return { raw: codigos[i % codigos.length] };
    });
    const refs: CeldaPlano[] = [
      { fila: 20, col: 36, valor: 'C', color: 'none' },
      { fila: 20, col: 37, valor: '07 a 15', color: 'none' },
      { fila: 20, col: 40, valor: 'P1M', color: 'none' },
      { fila: 20, col: 41, valor: '08 a 15', color: 'none' },
      { fila: 20, col: 43, valor: 'P1T', color: 'none' },
      { fila: 20, col: 44, valor: '15 a 22', color: 'none' },
      { fila: 20, col: 46, valor: 'P2M', color: 'none' },
      { fila: 20, col: 47, valor: '10 a 16', color: 'none' },
      { fila: 20, col: 49, valor: 'P2T', color: 'none' },
      { fila: 20, col: 50, valor: '16 a 22', color: 'none' },
      { fila: 20, col: 52, valor: 'C', color: 'rgb:92D050' },
      { fila: 20, col: 53, valor: 'CORTINA SABADO', color: 'none' },
      { fila: 21, col: 53, valor: '07 a 11', color: 'none' },
    ];
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'GANDIA LUIS', puesto: 'PUESTO 1', celdas: ciclo(0, 'M') },
      { nombre: 'GUZMAN ANA', puesto: 'PUESTO 1', celdas: ciclo(4, 'T') },
      { nombre: 'TRINKS JOSE', puesto: 'PUESTO 2', celdas: ciclo(0, 'M') },
      { nombre: 'CAMEJO MARIA', puesto: 'PUESTO 2', celdas: ciclo(4, 'T') },
      { nombre: 'BONILLA PEDRO', puesto: 'RELEVANTE', celdas: relevante },
      { nombre: 'CORREA LUCIA', puesto: 'CORTINA', celdas: cortina },
    ], refs), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const franja = (puesto: string, code: string) => prop.franjas.find((f) => f.puesto === puesto && f.code === code);
    const p1m = franja('Puesto 1', 'P1M');
    const p1t = franja('Puesto 1', 'P1T');
    const p2m = franja('Puesto 2', 'P2M');
    const p2t = franja('Puesto 2', 'P2T');
    assert.equal(p1m?.startTime, '08:00');
    assert.equal(p1m?.endTime, '15:00');
    assert.equal(p1t?.startTime, '15:00');
    assert.equal(p1t?.endTime, '22:00');
    assert.equal(p2m?.startTime, '10:00');
    assert.equal(p2m?.endTime, '16:00');
    assert.equal(p2t?.startTime, '16:00');
    assert.equal(p2t?.endTime, '22:00');
    for (const f of [p1m, p1t, p2m, p2t]) assert.equal(etiquetaDias(f?.dias || []), 'Todos');
    assert.equal(franja('Cortina', 'C') && etiquetaDias(franja('Cortina', 'C')!.dias), 'L–V');
    assert.equal(franja('Cortina', 'CS')?.startTime, '07:00');
    assert.equal(franja('Cortina', 'CS')?.endTime, '11:00');
    assert.equal(etiquetaDias(franja('Cortina', 'CS')?.dias || []), 'S');
    assert.equal(prop.franjas.some((f) => /RELEVANTE/i.test(f.puesto)), false);
    assert.match(prop.funciones?.join(' ') || '', /Relevante: cubre Puesto 1 y Puesto 2/);
    assert.match(prop.resumen || '', /Puesto 1/);
    assert.doesNotMatch(prop.resumen || '', /falta/);
    const eqP1 = prop.equivalencias.find((e) => e.codigo === 'P1M' && e.positionName === 'Puesto 1');
    assert.equal(eqP1?.code, 'P1M');
    assert.equal(eqP1?.startTime, '08:00');
    assert.equal(eqP1?.endTime, '15:00');
    assert.equal(prop.equivalencias.some((e) => e.codigo === 'M' && e.code !== 'M'), false);
  });

  it('mismo puesto y mismo horario conserva el código del servicio (P1M, Cortina, Refuerzo)', () => {
    const propuesta: FranjaServicioPlanilla[] = [
      { id: 'a', puesto: 'Puesto 1', code: 'M', startTime: '08:00', endTime: '15:00', cantidad: 1, dias: [] },
      { id: 'b', puesto: 'Puesto 1', code: 'T', startTime: '15:00', endTime: '22:00', cantidad: 1, dias: [] },
      { id: 'c', puesto: 'Puesto 2', code: 'M', startTime: '10:00', endTime: '16:00', cantidad: 1, dias: [] },
      { id: 'd', puesto: 'Puesto 2', code: 'T', startTime: '16:00', endTime: '22:00', cantidad: 1, dias: [] },
      { id: 'e', puesto: 'Cortina', code: 'C', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: ['L', 'M', 'X', 'J', 'V'] },
      { id: 'f', puesto: 'Refuerzo', code: 'RF', startTime: '12:00', endTime: '22:00', cantidad: 1, dias: ['V', 'S', 'D'] },
    ];
    const vigente = [
      { puesto: 'Puesto 1', code: 'P1M', startTime: '08:00', endTime: '15:00', cantidad: 1, dias: [] as string[] },
      { puesto: 'Puesto 1', code: 'P1T', startTime: '15:00', endTime: '22:00', cantidad: 1, dias: [] as string[] },
      { puesto: 'Puesto 2', code: 'P2M', startTime: '10:00', endTime: '16:00', cantidad: 1, dias: [] as string[] },
      { puesto: 'Puesto 2', code: 'P2T', startTime: '16:00', endTime: '22:00', cantidad: 1, dias: [] as string[] },
      { puesto: 'Cortina', code: 'CO', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: ['L', 'M', 'X', 'J', 'V'] },
      { puesto: 'Refuerzo', code: 'REF', startTime: '12:00', endTime: '22:00', cantidad: 1, dias: ['V', 'S', 'D'] },
    ];
    const diff = compararConVigente(propuesta, vigente);
    assert.equal(diff.some((d) => d.estado === 'falta' || d.estado === 'sobra'), false);
    assert.match(diff.find((d) => d.code === 'P1M')?.detalle || '', /M coincide \(código P1M en el servicio\)/);
    assert.match(diff.find((d) => d.code === 'CO')?.detalle || '', /código CO en el servicio/);
    assert.match(diff.find((d) => d.code === 'REF')?.detalle || '', /código REF en el servicio/);
    const adoptadas = adoptarCodigoVigente(propuesta, vigente);
    assert.deepEqual(adoptadas.map((f) => f.code), ['P1M', 'P1T', 'P2M', 'P2T', 'CO', 'REF']);
    assert.equal(adoptadas[0].codigoPlanilla, 'M');
    const eqs: EquivalenciaCodigo[] = [{
      clave: 'M|none', codigo: 'P1M', color: 'none', code: 'M', startTime: '08:00', endTime: '15:00', positionName: 'Puesto 1', muestras: 4,
    }];
    assert.equal(equivalenciasAlCodigoServicio(eqs, propuesta, adoptadas)[0].code, 'P1M');
    const otroHorario = compararConVigente(
      [{ id: 'z', puesto: 'Puesto 1', code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: [] as DiaSemana[] }],
      [{ puesto: 'Puesto 1', code: 'P1M', startTime: '08:00', endTime: '15:00', cantidad: 1, dias: [] }],
    );
    assert.equal(otroHorario.find((d) => d.code === 'M')?.estado, 'falta');
    assert.equal(otroHorario.find((d) => d.code === 'P1M')?.estado, 'sobra');
    const lineas = lineasConfirmacion(diff, 'actualizar', 'octubre');
    assert.match(lineas.join(' '), /No hay diferencias/);
  });
});

describe('servicio desde la planilla · fechas del mes', () => {
  it('una franja que no se repite por día de la semana va por fechas y se guarda como specificDates', () => {
    const dias = new Set([2, 3, 4, 30, 31]);
    const celdas = Array.from({ length: 31 }, (_, i) => (dias.has(i + 1) ? { raw: 'M' } : { raw: 'F' }));
    const [cuadro] = detectarCuadros(planilla([{ nombre: 'PEREZ JUAN', puesto: 'Puesto 1', celdas }]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const f = prop.franjas.find((x) => x.code === 'M');
    assert.ok(f, 'la franja no se pierde');
    assert.deepEqual(f?.fechas, ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-30', '2026-10-31']);
    assert.equal(etiquetaFechas(f?.fechas || []), '2, 3, 4, 30 y 31');
    assert.deepEqual(diasDeFechas(f?.fechas || []), ['V', 'S', 'D']);
    const [pos] = posicionesDesdeFranjas(prop.franjas);
    assert.deepEqual(pos.allowedShiftTypes[0].specificDates, f?.fechas);
    assert.equal(pos.allowedShiftTypes[0].days, undefined);
  });
});

describe('servicio desde la planilla · puesto de 24 h', () => {
  const f = (puesto: string, code: string, startTime: string, endTime: string) => ({ id: `${puesto}${code}`, puesto, code, startTime, endTime, cantidad: 1, dias: [] });
  it('M+T+N, D12+N12 y P1M+P1T+P1N son 24 HS; Rondín y un puesto de 2 bandas no', () => {
    assert.equal(cubre24Horas([f('Puesto 1', 'M', '07:00', '15:00'), f('Puesto 1', 'T', '15:00', '23:00'), f('Puesto 1', 'N', '23:00', '07:00')]), true);
    assert.equal(cubre24Horas([f('B', 'D12', '07:00', '19:00'), f('B', 'N12', '19:00', '07:00')]), true);
    assert.equal(cubre24Horas([f('P', 'M', '07:00', '15:00'), f('P', 'T', '15:00', '23:00')]), false);
    const docs = posicionesDesdeFranjas([
      f('Puesto 1', 'P1M', '08:00', '15:00'), f('Puesto 1', 'P1T', '15:00', '22:00'), f('Puesto 1', 'P1N', '22:00', '08:00'),
      f('Rondín', 'M', '07:00', '15:00'), f('Rondín', 'T', '15:00', '23:00'), f('Rondín', 'N', '23:00', '07:00'),
      f('Puesto 2', 'P2M', '10:00', '16:00'), f('Puesto 2', 'P2T', '16:00', '22:00'),
    ]);
    const tipo = (n: string) => docs.find((d) => d.name === n)?.coverageType;
    assert.equal(tipo('Puesto 1'), '24hs');
    assert.equal(tipo('Rondín'), 'custom');
    assert.equal(tipo('Puesto 2'), 'custom');
  });
  it('al actualizar, un puesto existente conserva su tipo', () => {
    const docs = posicionesDesdeFranjas([f('Puesto 1', 'M', '07:00', '15:00')], [{ id: 'x', name: 'Puesto 1', coverageType: '24hs', quantity: 1, activeDays: [], allowedShiftTypes: [], status: 'ACTIVE' }]);
    assert.equal(docs[0].coverageType, '24hs');
  });
});
