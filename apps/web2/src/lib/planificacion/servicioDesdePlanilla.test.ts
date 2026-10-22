import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectarCuadros, normPlanilla, type CeldaPlano } from './importarExcel';
import { prepararPegadoExcel } from './modoRapido';
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';
import { calculateSlaHoursForMonth } from '../servicios/slaHoursCalculator';
import { evaluarCoberturaDia } from './positionCoverageUnits';
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
  tipoPuestoPropuesto,
  separarPuesto,
  unirPuestos,
  renombrarPuesto,
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

describe('cantidad por banda al armar el puesto', () => {
  const banda = (code: 'M' | 'T' | 'N', cantidad: number) => ({
    id: code,
    puesto: 'Guardia',
    code,
    startTime: code === 'M' ? '07:00' : code === 'T' ? '15:00' : '23:00',
    endTime: code === 'M' ? '15:00' : code === 'T' ? '23:00' : '07:00',
    cantidad,
    dias: [] as Array<'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D'>,
  });
  const qty = (pos: { allowedShiftTypes: Array<{ code: string; quantity?: number }> }, code: string) =>
    pos.allowedShiftTypes.find((s) => s.code === code)?.quantity;

  it('1-1-1 es 24 h con quantity 1', () => {
    const [pos] = posicionesDesdeFranjas([banda('M', 1), banda('T', 1), banda('N', 1)]);
    assert.equal(pos.coverageType, '24hs');
    assert.equal(pos.quantity, 1);
    assert.equal(tipoPuestoPropuesto('Guardia', [banda('M', 1), banda('T', 1), banda('N', 1)]).tipo, '24hs');
  });

  it('2-2-2 es 24 h con quantity 2', () => {
    const [pos] = posicionesDesdeFranjas([banda('M', 2), banda('T', 2), banda('N', 2)]);
    assert.equal(pos.coverageType, '24hs');
    assert.equal(pos.quantity, 2);
  });

  it('1-2-2 es custom M1 T2 N2 y suma 40 h por día', () => {
    const franjas = [banda('M', 1), banda('T', 2), banda('N', 2)];
    const [pos] = posicionesDesdeFranjas(franjas, [{
      id: 'guardia', name: 'Guardia', coverageType: '24hs', quantity: 2, activeDays: [], allowedShiftTypes: [{ code: 'T', name: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 }], status: 'ACTIVE',
    }]);
    assert.equal(pos.coverageType, 'custom');
    assert.equal(qty(pos, 'M'), 1);
    assert.equal(qty(pos, 'T'), 2);
    assert.equal(qty(pos, 'N'), 2);
    assert.equal(pos.allowedShiftTypes.some((s) => s.code === 'D12'), false);
    const horas = calculateSlaHoursForMonth([pos as any], '2026-10-05', '2026-10-05', [], 2026, 9).total;
    assert.equal(horas, 40);
    assert.match(tipoPuestoPropuesto('Guardia', franjas).motivo, /40 h/);
  });

  it('la planilla 1×M 2×T 2×N no se parte en 24 h más extras', () => {
    const todos = (raw: string) => Array.from({ length: 31 }, () => ({ raw }));
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'PEREZ JUAN', puesto: 'Guardia', celdas: todos('M') },
      { nombre: 'GOMEZ ANA', puesto: 'Guardia', celdas: todos('T') },
      { nombre: 'LOPEZ MARIO', puesto: 'Guardia', celdas: todos('T') },
      { nombre: 'DIAZ LUIS', puesto: 'Guardia', celdas: todos('N') },
      { nombre: 'RUIZ JOSE', puesto: 'Guardia', celdas: todos('N') },
    ]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const linea = (f: { puesto: string; code: string; cantidad: number }) => `${f.puesto}·${f.code}×${f.cantidad}`;
    assert.deepEqual(prop.franjas.map(linea).sort(), ['Guardia·M×1', 'Guardia·N×2', 'Guardia·T×2'].sort());
    const pos = posicionesDesdeFranjas(prop.franjas).find((p) => p.name === 'Guardia');
    assert.equal(pos?.coverageType, 'custom');
  });
});

describe('feriados del puesto', () => {
  const puesto = {
    name: 'Guardia',
    positionName: 'Guardia',
    quantity: 1,
    qty: 1,
    coverageType: 'custom' as const,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    status: 'ACTIVE' as const,
    allowedShiftTypes: [{ code: 'M', name: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 }],
    shifts: [{ code: 'M', hours: 8, startTime: '07:00', endTime: '15:00', quantity: 1 }],
  };

  it('−F en un feriado no exige cobertura y descuenta ese día de las vendidas; +F sigue igual', () => {
    const mas = calculateSlaHoursForMonth([puesto as any], '2026-10-01', '2026-10-31', [], 2026, 9).total;
    const menos = calculateSlaHoursForMonth([{ ...puesto, trabajaFeriados: false } as any], '2026-10-01', '2026-10-31', [], 2026, 9).total;
    assert.equal(mas - menos, 8);
    assert.equal(evaluarCoberturaDia([{ ...puesto, trabajaFeriados: false }], [], 'L', '2026-10-12').required, 0);
    assert.equal(evaluarCoberturaDia([puesto], [], 'L', '2026-10-12').required, 1);
    assert.equal(evaluarCoberturaDia([{ ...puesto, trabajaFeriados: false }], [], 'L', '2026-10-05').required, 1);
  });

  it('el editor guarda −F en el puesto', () => {
    const franjas = [{ id: 'm', puesto: 'Guardia', code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: [] as Array<'L'>, trabajaFeriados: false as const }];
    const [pos] = posicionesDesdeFranjas(franjas, [{ id: 'g', name: 'Guardia', coverageType: 'custom', quantity: 1, activeDays: [], allowedShiftTypes: [], status: 'ACTIVE', trabajaFeriados: true }]);
    assert.equal(pos.trabajaFeriados, false);
  });
});

describe('servicio desde la planilla · tipo de puesto visible', () => {
  it('dice si el puesto es 24 HS o custom y por qué', () => {
    const f = (code: string, startTime: string, endTime: string) => ({ code, startTime, endTime });
    assert.deepEqual(tipoPuestoPropuesto('Puesto 1', [f('M', '06:00', '14:00'), f('T', '14:00', '22:00'), f('N', '22:00', '06:00')]), { tipo: '24hs', motivo: 'M+T+N cubren el día · admite D12/N12' });
    assert.equal(tipoPuestoPropuesto('Puesto 2', [f('M', '10:00', '16:00')]).tipo, 'custom');
    assert.equal(tipoPuestoPropuesto('Rondín', [f('M', '07:00', '15:00'), f('T', '15:00', '23:00'), f('N', '23:00', '07:00')]).tipo, 'custom');
  });
});

describe('servicio desde la planilla · separar, unir y renombrar puestos', () => {
  const f = (puesto: string, code: string, cantidad: number, dias: Array<'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D'> = []) => ({ id: `${puesto}${code}${dias.join('')}`, puesto, code, startTime: code === 'M' ? '06:00' : code === 'T' ? '14:00' : '22:00', endTime: code === 'M' ? '14:00' : code === 'T' ? '22:00' : '06:00', cantidad, dias });
  it('Puesto 1 ×4 se separa en Puesto 1..4 ×1', () => {
    const r = separarPuesto([f('Puesto 1', 'M', 4), f('Puesto 1', 'N', 4)], 'Puesto 1');
    assert.deepEqual([...new Set(r.map((x) => x.puesto))], ['Puesto 1', 'Puesto 2', 'Puesto 3', 'Puesto 4']);
    assert.ok(r.every((x) => x.cantidad === 1));
    assert.equal(r.length, 8);
  });
  it('separar respeta la cantidad de cada franja y salta nombres usados', () => {
    const r = separarPuesto([f('Puesto 1', 'M', 2), f('Puesto 1', 'N', 1), f('Puesto 2', 'M', 1)], 'Puesto 1');
    assert.deepEqual(r.filter((x) => x.puesto !== 'Puesto 2').map((x) => `${x.puesto}:${x.code}`), ['Puesto 1:M', 'Puesto 1:N', 'Puesto 3:M']);
  });
  it('unir suma las franjas iguales y renombrar cambia todas', () => {
    const r = unirPuestos([f('Puesto 1', 'M', 1), f('Puesto 2', 'M', 1), f('Puesto 2', 'T', 1)], 'Puesto 1', 'Puesto 2');
    assert.deepEqual(r.map((x) => `${x.puesto}:${x.code}×${x.cantidad}`), ['Puesto 1:M×2', 'Puesto 1:T×1']);
    assert.deepEqual(renombrarPuesto(r, 'Puesto 1', 'Bunker').map((x) => x.puesto), ['Bunker', 'Bunker']);
  });
});

describe('servicio desde la planilla · puestos de 24 h por conteo de bandas', () => {
  it('6 M · 4 T · 4 N por día son 4 puestos de 24 h y 2 M extra de lunes a viernes', () => {
    const banda = (i: number) => ['M', 'T', 'N', 'F'][i % 4];
    const rot = (off: number) => Array.from({ length: 31 }, (_, d) => ({ raw: banda(d + off) }));
    const lv = Array.from({ length: 31 }, (_, d) => ({ raw: ['S', 'D'].includes(letraDia(2026, 10, d + 1)) ? 'F' : 'M' }));
    const filas = [0, 1, 2, 3, 0, 1, 2, 3].map((off, i) => ({ nombre: `G${i}`, puesto: 'Puesto', celdas: rot(off) }));
    const [cuadro] = detectarCuadros(planilla([...filas, { nombre: 'E1', puesto: 'Puesto', celdas: lv }, { nombre: 'E2', puesto: 'Puesto', celdas: lv }]), 2026, 10);
    const prop = proponerServicioDesdePlanilla(cuadro, 2026, 10);
    const linea = (f: { puesto: string; code: string; cantidad: number; dias: string[]; definirHorario?: boolean }) => `${f.puesto}·${f.code}×${f.cantidad}·${etiquetaDias(f.dias)}${f.definirHorario ? '·definir' : ''}`;
    assert.deepEqual(prop.franjas.map(linea).sort(), ['Extra M·M×2·L–V·definir', 'Puesto·M×2·Todos', 'Puesto·N×2·Todos', 'Puesto·T×2·Todos'].sort());
  });
});

describe('Colegio Padre Claret · horario real del código', () => {
  const horario = [
    { puesto: 'Vigilancia', code: 'M', startTime: '07:00', endTime: '15:00' },
    { puesto: 'Vigilancia', code: 'T', startTime: '15:00', endTime: '23:00' },
    { puesto: 'Vigilancia', code: 'N', startTime: '23:00', endTime: '08:00' },
    { puesto: 'Vigilancia', code: 'NE', startTime: '23:00', endTime: '08:00' },
  ];
  const finde = (letra: string) => letra === 'S' || letra === 'D';
  function cuadroClaret() {
    const sd = Array.from({ length: 31 }, (_, i) => (finde(letraDia(2026, 10, i + 1)) ? { raw: 'NE' } : { raw: 'F' }));
    const [cuadro] = detectarCuadros(planilla([
      { nombre: 'PEREZ JUAN', puesto: 'Vigilancia', celdas: mes('M', LV) },
      { nombre: 'GOMEZ ANA', puesto: 'Vigilancia', celdas: mes('T', LV) },
      { nombre: 'LOPEZ MARIO', puesto: 'Vigilancia', celdas: mes('N', LV) },
      { nombre: 'DIAZ LUIS', puesto: 'Vigilancia', celdas: sd },
    ]), 2026, 10);
    return cuadro;
  }

  it('N queda en 9 h (23–08) y NE solo sábados y domingos; activeDays es la unión', () => {
    const prop = proponerServicioDesdePlanilla(cuadroClaret(), 2026, 10, { vigente: horario, catalogo: horario });
    const n = prop.franjas.find((f) => f.code === 'N');
    const ne = prop.franjas.find((f) => f.code === 'NE');
    assert.equal(n?.startTime, '23:00');
    assert.equal(n?.endTime, '08:00');
    assert.deepEqual(n?.dias, ['L', 'M', 'X', 'J', 'V']);
    assert.equal(ne?.startTime, '23:00');
    assert.equal(ne?.endTime, '08:00');
    assert.deepEqual(ne?.dias, ['S', 'D']);
    assert.equal(prop.franjas.some((f) => f.code === 'N12' || f.code === 'D12'), false);
    const [pos] = posicionesDesdeFranjas(prop.franjas);
    assert.equal(pos.coverageType, 'custom');
    assert.deepEqual(pos.activeDays, ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    const noche = pos.allowedShiftTypes.find((s) => s.code === 'N');
    assert.equal(noche?.hours, 9);
    assert.equal(noche?.endTime, '08:00');
    assert.deepEqual(pos.allowedShiftTypes.find((s) => s.code === 'NE')?.days, ['S', 'D']);
    assert.equal(pos.allowedShiftTypes.some((s) => s.code === 'N12'), false);
  });

  it('el catálogo de la empresa alcanza si el objetivo todavía no tiene ese servicio', () => {
    const prop = proponerServicioDesdePlanilla(cuadroClaret(), 2026, 10, { catalogo: horario });
    assert.equal(prop.franjas.find((f) => f.code === 'N')?.endTime, '08:00');
    assert.equal(prop.franjas.find((f) => f.code === 'NE')?.endTime, '08:00');
    assert.deepEqual(prop.franjas.find((f) => f.code === 'NE')?.dias, ['S', 'D']);
    const [pos] = posicionesDesdeFranjas(prop.franjas);
    assert.equal(pos.activeDays.length, 7);
    assert.equal(pos.allowedShiftTypes.find((s) => s.code === 'N')?.hours, 9);
  });

  it('sin horario conocido pregunta y no inventa N 23–07 ni N12', () => {
    const prop = proponerServicioDesdePlanilla(cuadroClaret(), 2026, 10, { catalogo: [], vigente: [] });
    const n = prop.franjas.find((f) => f.code === 'N');
    const ne = prop.franjas.find((f) => f.code === 'NE');
    assert.equal(n?.definirHorario, true);
    assert.equal(n?.startTime, '');
    assert.equal(n?.endTime, '');
    assert.deepEqual(n?.dias, ['L', 'M', 'X', 'J', 'V']);
    assert.equal(ne?.definirHorario, true);
    assert.deepEqual(ne?.dias, ['S', 'D']);
    assert.equal(prop.franjas.some((f) => f.code === 'N12'), false);
    const [pos] = posicionesDesdeFranjas(prop.franjas);
    assert.deepEqual(pos.activeDays, ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    assert.equal(pos.activeDays.length > 0, true);
  });
});

describe('editar el servicio vigente desde Planificación', () => {
  it('conserva lo que el editor no muestra y aplica lo editado', () => {
    const previa = {
      id: 'p1', name: 'Puesto 1', coverageType: 'custom', quantity: 1, activeDays: ['S', 'D'], status: 'ACTIVE',
      excludedDates: ['2026-10-25'],
      allowedShiftTypes: [{ code: 'VFM', name: 'Vifood mañana', startTime: '07:00', endTime: '19:00', hours: 12, quantity: 1, days: ['D'], blocks: [{ startTime: '07:00', endTime: '11:00' }, { startTime: '13:00', endTime: '19:00' }] }],
    };
    const franjas = franjasDesdeVigente([{ puesto: 'Puesto 1', code: 'VFM', startTime: '07:00', endTime: '19:00', cantidad: 1, dias: ['D'] }]);
    franjas[0].feriados = true;
    const [pos] = posicionesDesdeFranjas(franjas, [previa as any]);
    assert.deepEqual((pos as any).excludedDates, ['2026-10-25']);
    const st = pos.allowedShiftTypes[0] as any;
    assert.equal(st.name, 'Vifood mañana');
    assert.equal(st.blocks.length, 2);
    assert.equal(st.feriados, true);
    assert.deepEqual(st.days, ['D']);
  });
});
