import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cruzarGuardias,
  cruzarGuardiasPorTandas,
  normPlanilla,
  proponerReglas,
  vistaPrevia,
  vistaPreviaPorTandas,
  type CruceFila,
  type EmpleadoCruce,
  type FilaPlanilla,
} from './importarExcel';

function toks(s: string): string[] {
  return normPlanilla(s).replace(/[,.]/g, ' ').replace(/\(.*?\)/g, ' ').split(' ').filter((t) => t.length > 1 && !['DE', 'DEL', 'LA', 'LOS', 'Y'].includes(t));
}

function partesNombre(e: EmpleadoCruce): { last: string[]; first: string[]; all: string[] } {
  const raw = e.nombre || '';
  const [ap, no] = raw.includes(',') ? raw.split(',') : [raw.split(' ').slice(-1).join(' '), raw.split(' ').slice(0, -1).join(' ')];
  return { last: toks(ap), first: toks(no), all: [...toks(ap), ...toks(no)] };
}

function tokHit(t: string, cands: string[]): boolean {
  return cands.some((c) => c === t || (t.length >= 3 && c.startsWith(t)) || (c.length >= 4 && t.startsWith(c)));
}

function puntaje(ptoks: string[], e: EmpleadoCruce): { sc: number; last: boolean; first: boolean } {
  if (!ptoks.length) return { sc: 0, last: false, first: false };
  const p = partesNombre(e);
  const hit = ptoks.filter((t) => tokHit(t, p.all)).length / ptoks.length;
  return { sc: hit, last: ptoks.some((t) => tokHit(t, p.last)), first: ptoks.some((t) => tokHit(t, p.first)) };
}

/** Barrido completo, el de antes del índice por apellido. */
function cruzarBruto(filas: FilaPlanilla[], empleados: EmpleadoCruce[], empresaId: string): CruceFila[] {
  const activos = empleados.filter((e) => e.id);
  const porNombre = (ptoks: string[]) => {
    if (!ptoks.length) return null;
    const scored: Array<{ rank: number; e: EmpleadoCruce }> = [];
    for (const e of activos) {
      const p = puntaje(ptoks, e);
      if (p.sc >= 0.99 && p.last && (p.first || ptoks.length === 1)) scored.push({ rank: 0, e });
      else if (p.last && p.first && p.sc >= 0.5) scored.push({ rank: 1, e });
    }
    if (!scored.length) {
      const lastOnly = activos.filter((e) => ptoks[0] && partesNombre(e).last.includes(ptoks[0]));
      if (lastOnly.length === 1 && ptoks.length >= 2) {
        return { id: lastOnly[0].id, dudoso: true };
      }
      return null;
    }
    const bestRank = Math.min(...scored.map((s) => s.rank));
    const best = scored.filter((s) => s.rank === bestRank).map((s) => s.e);
    const pick = [...best].sort((a, b) => Number(a.empresaId !== empresaId) - Number(b.empresaId !== empresaId))[0];
    return { id: pick.id, dudoso: bestRank !== 0 || new Set(best.map((e) => e.id)).size > 1 };
  };
  return filas.filter((f) => normPlanilla(f.nombre)).map((f) => {
    const alt = porNombre(toks(f.nombre));
    return {
      fila: f.fila,
      nombrePlanilla: f.nombre,
      legajo: '',
      estado: alt ? (alt.dudoso ? 'dudoso' : 'encontrado') : 'no',
      employeeId: alt?.id || null,
      nota: '',
      candidatos: [],
    } as CruceFila;
  });
}

function fila(i: number, nombre: string): FilaPlanilla {
  return {
    fila: i,
    nombre,
    legajo: '',
    puesto: 'Puesto 1',
    celdas: [{ dia: 1, raw: 'M', color: 'none' }, { dia: 2, raw: 'F', color: 'none' }],
  };
}

describe('importar excel en tandas', () => {
  const base: EmpleadoCruce[] = [
    { id: '1', nombre: 'PEREZ JUAN', legajo: '10', empresaId: 'pruebas_sa' },
    { id: '2', nombre: 'PEREZ ANA', legajo: '11', empresaId: 'pruebas_sa' },
    { id: '3', nombre: 'PEREIRA LUIS', legajo: '12', empresaId: 'pruebas_sa' },
    { id: '4', nombre: 'GOMEZ MARIA', legajo: '13', empresaId: 'otra' },
    { id: '5', nombre: 'GOMEZ MARIA', legajo: '14', empresaId: 'pruebas_sa' },
  ];
  for (let i = 0; i < 60; i++) {
    base.push({ id: `x${i}`, nombre: `ZZZ${i} NOMBRE${i}`, legajo: String(1000 + i), empresaId: 'pruebas_sa' });
  }
  const filas = [
    fila(1, 'PEREZ JUAN'),
    fila(2, 'PER JUAN'),
    fila(3, 'GOMEZ MARIA'),
    fila(4, 'NADIE AQUI'),
    fila(5, 'PEREIRA LUIS'),
    ...Array.from({ length: 40 }, (_, i) => fila(10 + i, `ZZZ${i} NOMBRE${i}`)),
  ];

  it('el índice de apellidos coincide con el barrido completo', () => {
    const bruto = cruzarBruto(filas, base, 'pruebas_sa');
    const idx = cruzarGuardias(filas, base, 'pruebas_sa');
    assert.equal(idx.length, bruto.length);
    idx.forEach((c, i) => {
      assert.equal(c.employeeId, bruto[i].employeeId, c.nombrePlanilla);
      assert.equal(c.estado === 'no', bruto[i].estado === 'no');
    });
  });

  it('las tandas ceden el hilo y arman la misma vista', async () => {
    let cedio = 0;
    const ceder = async () => { cedio += 1; };
    const deUna = cruzarGuardias(filas, base, 'pruebas_sa');
    const porTandas = await cruzarGuardiasPorTandas(filas, base, 'pruebas_sa', ceder);
    assert.ok(cedio >= 1);
    assert.deepEqual(porTandas.map((c) => [c.fila, c.employeeId, c.estado]), deUna.map((c) => [c.fila, c.employeeId, c.estado]));

    const cuadro = {
      indice: 0,
      titulo: 'Objetivo',
      letras: 'LM',
      avisoMes: null,
      filas,
      referencias: [],
      avisos: [],
    };
    const reglas = proponerReglas(cuadro);
    const opts = {
      year: 2026,
      month: 10,
      cuadro,
      reglas,
      cruce: deUna,
      incluirDudosos: true,
      turnos: [{ positionName: 'Puesto 1', code: 'M', startTime: '07:00', endTime: '15:00', quantity: 1 }],
      actuales: [],
    };
    cedio = 0;
    const previa = vistaPrevia(opts);
    const previaTandas = await vistaPreviaPorTandas(opts, ceder);
    assert.ok(cedio >= 1);
    assert.deepEqual(previaTandas, previa);
  });
});
