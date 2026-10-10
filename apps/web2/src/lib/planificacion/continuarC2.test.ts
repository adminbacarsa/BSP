import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bandaDe,
  continuarC2,
  esqueletoDelMes,
  nivelarContraCupo,
  punteroAlCierre,
  rasgosDeHistoria,
  type CupoDia,
  type HistoriaC2,
} from '@/lib/planificacion/continuarC2';
import { cupoDelServicio, diaIndex, ymdDeIndex, type PuestoSla } from '@/lib/planificacion/continuarMesAnterior';

const ROTA = [...Array(6).fill('M'), 'F', 'F', ...Array(6).fill('N'), 'F', 'F', ...Array(6).fill('T'), 'F', 'F'];

function dias(y: number, m: number): string[] {
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

/** Historia siguiendo `patron` con la fase alineada al índice absoluto + `off`. */
function hist(id: string, patron: string[], desde: string, hasta: string, off = 0): HistoriaC2 {
  const crudo: HistoriaC2['crudo'] = [];
  for (let i = diaIndex(desde); i <= diaIndex(hasta); i += 1) {
    crudo.push({ idx: i, code: patron[(((i + off) % patron.length) + patron.length) % patron.length] });
  }
  return { id, nombre: `${id.toUpperCase()}, Test`, crudo };
}

function esperado(patron: string[], ds: string[], off = 0): string[] {
  return ds.map((d) => patron[(((diaIndex(d) + off) % patron.length) + patron.length) % patron.length]);
}

const OCT = dias(2026, 10);

test('bandaDe: D12 cuenta como M, N12 como N, M2 como M', () => {
  assert.equal(bandaDe('D12'), 'M');
  assert.equal(bandaDe('N12'), 'N');
  assert.equal(bandaDe('M2'), 'M');
  assert.equal(bandaDe('RET'), null);
});

test('esqueleto: un día suelto de otra banda en un bloque de 6 se aplana; 2+2+2 no', () => {
  const b = new Map<number, string>();
  ['M', 'M', 'T', 'M', 'M', 'M', 'F', 'F'].forEach((c, k) => b.set(1000 + k, c));
  assert.deepEqual([...esqueletoDelMes(b).values()].slice(0, 6), Array(6).fill('M'));
  const c = new Map<number, string>();
  ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F'].forEach((x, k) => c.set(2000 + k, x));
  assert.deepEqual([...esqueletoDelMes(c).values()], ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F']);
});

test('plantilla del objetivo y grupo: dos guardias en la misma fase comparten grupo', () => {
  const hs = [
    hist('a', ROTA, '2026-07-01', '2026-09-30', 0),
    hist('b', ROTA, '2026-07-01', '2026-09-30', 0),
    hist('c', ROTA, '2026-07-01', '2026-09-30', 8),
  ];
  const planes = continuarC2({ historias: hs, orden: ['a', 'b', 'c'], dias: OCT });
  const a = planes.get('a')!;
  assert.equal(a.via, 'plantilla');
  assert.equal(a.periodo, 24);
  assert.equal(a.grupo, 'A');
  assert.equal(planes.get('b')!.grupo, 'A');
  assert.equal(planes.get('c')!.grupo, null);
  assert.deepEqual(OCT.map((d) => a.codes[d]), esperado(ROTA, OCT, 0));
  assert.deepEqual(OCT.map((d) => planes.get('c')!.codes[d]), esperado(ROTA, OCT, 8));
});

test('fase: con solo los últimos 14 días sigue la racha donde quedó (no arranca en el día 1)', () => {
  const hs = [
    hist('a', ROTA, '2026-07-01', '2026-09-30', 0),
    hist('b', ROTA, '2026-07-01', '2026-09-30', 4),
    hist('nuevo', ROTA, '2026-09-17', '2026-09-30', 12),
  ];
  const p = continuarC2({ historias: hs, orden: ['a', 'b', 'nuevo'], dias: OCT }).get('nuevo')!;
  assert.deepEqual(OCT.map((d) => p.codes[d]), esperado(ROTA, OCT, 12));
});

test('mes anterior sin cargar: la fase se mide desde el último día con dato', () => {
  const hs = [
    hist('a', ROTA, '2026-06-01', '2026-08-31', 0),
    hist('b', ROTA, '2026-06-01', '2026-08-31', 8),
    hist('fijoN', ['N', 'N', 'N', 'N', 'N', 'N', 'F', 'F'], '2026-06-01', '2026-08-31', 0),
  ];
  const planes = continuarC2({ historias: hs, orden: ['a', 'b', 'fijoN'], dias: OCT });
  assert.deepEqual(OCT.map((d) => planes.get('a')!.codes[d]), esperado(ROTA, OCT, 0));
  const fijo = planes.get('fijoN');
  assert.ok(!fijo || OCT.every((d) => !fijo.codes[d] || ['N', 'F'].includes(fijo.codes[d])));
});

test('ciclo propio limpio distinto de la plantilla (5+2 vs 6+2): no se fuerza la plantilla', () => {
  const hs = [
    hist('a', ROTA, '2026-07-01', '2026-09-30', 0),
    hist('b', ROTA, '2026-07-01', '2026-09-30', 8),
    hist('c', ROTA, '2026-07-01', '2026-09-30', 16),
    hist('lv', ['M', 'M', 'M', 'M', 'M', 'F', 'F'], '2026-07-01', '2026-09-30', 0),
  ];
  const p = continuarC2({ historias: hs, orden: ['a', 'b', 'c', 'lv'], dias: OCT }).get('lv');
  assert.ok(!p || p.periodo !== 24);
});

test('compañero: poca historia igual a la de otro → «copia de»', () => {
  const hs = [
    hist('a', ROTA, '2026-07-01', '2026-09-30', 0),
    hist('b', ROTA, '2026-07-01', '2026-09-30', 8),
    hist('corto', ROTA, '2026-09-23', '2026-09-30', 8),
  ];
  const p = continuarC2({ historias: hs, orden: ['a', 'b', 'corto'], dias: OCT }).get('corto')!;
  assert.equal(p.via, 'compañero');
  assert.equal(p.copiaDeId, 'b');
  assert.deepEqual(OCT.map((d) => p.codes[d]), esperado(ROTA, OCT, 8));
});

test('herencia: un alta sin historia toma la fila del que se fue', () => {
  const hs = [
    hist('a', ROTA, '2026-07-01', '2026-09-30', 0),
    hist('b', ROTA, '2026-07-01', '2026-09-30', 8),
    hist('baja', ROTA, '2026-07-01', '2026-09-30', 16),
    { id: 'alta', nombre: 'ALTA, Test', crudo: [] },
  ];
  const p = continuarC2({ historias: hs, orden: ['a', 'b', 'alta'], salientes: ['baja'], dias: OCT }).get('alta')!;
  assert.equal(p.via, 'herencia');
  assert.equal(p.copiaDeId, 'baja');
  assert.deepEqual(OCT.map((d) => p.codes[d]), esperado(ROTA, OCT, 16));
});

test('nivelación en diagonal: sobra N y falta T → el primero en el orden pasa a T, uno por bloque', () => {
  const ds = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const grid = new Map<string, Map<string, string>>([
    ['x', new Map(ds.map((d) => [d, 'N']))],
    ['y', new Map(ds.map((d) => [d, 'N']))],
    ['z', new Map(ds.map((d) => [d, 'M']))],
  ]);
  const cupo = (): CupoDia => ({ M: 1, T: 1, N: 1 });
  const r = nivelarContraCupo({ grid, orden: ['x', 'y', 'z'], dias: ds, nombres: new Map([['x', 'EQUIS, A'], ['y', 'YE, B']]), fijos: new Set(), cupo, punteroPrevio: [] });
  assert.deepEqual((r.get('x') || []).map((n) => `${n.dateStr}:${n.de}→${n.a}`), ['2026-10-01:N→T', '2026-10-03:N→T']);
  assert.deepEqual((r.get('y') || []).map((n) => n.dateStr), ['2026-10-02']);
  assert.match(r.get('x')![0].texto, /^01\/10: EQUIS N→T para cubrir T$/);
  const conFijo = nivelarContraCupo({ grid, orden: ['x', 'y', 'z'], dias: ds, nombres: new Map(), fijos: new Set(['x']), cupo, punteroPrevio: [] });
  assert.equal(conFijo.get('y')![0].dateStr, '2026-10-01');
  const conPuntero = nivelarContraCupo({ grid, orden: ['x', 'y', 'z'], dias: ds, nombres: new Map(), fijos: new Set(), cupo, punteroPrevio: ['x'] });
  assert.equal(conPuntero.get('y')![0].dateStr, '2026-10-01');
});

test('celdas ya cargadas cuentan para el cupo y no se mueven', () => {
  const ds = ['2026-10-01'];
  const grid = new Map<string, Map<string, string>>([
    ['x', new Map([[ds[0], 'N']])],
    ['y', new Map([[ds[0], 'N']])],
  ]);
  const r = nivelarContraCupo({ grid, orden: ['x', 'y'], dias: ds, nombres: new Map(), fijos: new Set(), cupo: () => ({ M: 0, T: 1, N: 1 }), punteroPrevio: [], bloqueadas: new Set(['x|2026-10-01']) });
  assert.equal(r.get('x'), undefined);
  assert.equal(r.get('y')![0].a, 'T');
});

test('puntero al cierre: quien termina el mes con un cambio aceptado en su último bloque', () => {
  const ds = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
  const out = punteroAlCierre([
    { id: 'x', codes: { '2026-10-28': 'F', '2026-10-29': 'N', '2026-10-30': 'N', '2026-10-31': 'N' }, aceptadas: [{ dateStr: '2026-10-30', de: 'N', a: 'T', cubre: 'T', texto: '' }] },
    { id: 'y', codes: { '2026-10-28': 'N', '2026-10-29': 'F', '2026-10-30': 'M', '2026-10-31': 'M' }, aceptadas: [{ dateStr: '2026-10-28', de: 'N', a: 'T', cubre: 'T', texto: '' }] },
  ], ds);
  assert.deepEqual(out, ['x']);
});

test('rasgos: banda fija en el mes de origen y puntero derivado', () => {
  const fijo = hist('f', ['N', 'N', 'N', 'N', 'N', 'N', 'F', 'F'], '2026-09-01', '2026-09-30');
  const rota = hist('r', ROTA, '2026-09-01', '2026-09-30');
  const r = rasgosDeHistoria([fijo, rota], OCT);
  assert.ok(r.fijos.has('f'));
  assert.ok(!r.fijos.has('r'));
  assert.equal(ymdDeIndex(diaIndex('2026-09-30')), '2026-09-30');
});

test('cupoDelServicio: cuenta los turnos de 8 h y deja afuera los de 12 h alternativos', () => {
  const est: PuestoSla[] = [{
    positionName: 'Puesto 1',
    qty: 1,
    shifts: [
      { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
      { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
      { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
      { code: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
      { code: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
    ],
  }];
  assert.deepEqual(cupoDelServicio(est, '2026-10-01'), { M: 1, T: 1, N: 1 });
});
