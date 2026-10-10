import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectarCuadros, type CeldaPlano } from './importarExcel';
import { prepararPegadoExcel } from './modoRapido';
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';
import {
  avisosFueraDeServicio,
  compararConVigente,
  etiquetaDias,
  letraDia,
  lineasConfirmacion,
  proponerServicioDesdePlanilla,
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
});
