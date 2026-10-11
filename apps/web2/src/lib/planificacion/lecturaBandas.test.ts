import assert from 'node:assert/strict';
import test from 'node:test';
import { contarEstandar, faltantesDelDia, leerDia, proponerLiberar, puestoConLugar, type PuestoServicio, type TurnoDia } from './lecturaBandas';
import type { TurnoPuesto12 } from './cierre12h';

const DIA = '2026-10-01';

const puestos2x2: PuestoServicio[] = [
  { positionName: 'Puesto 1', qty: 2, coverageType: '24hs', shifts: [{ code: 'M' }, { code: 'T' }, { code: 'N' }] },
  { positionName: 'Puesto 2', qty: 2, coverageType: '24hs', shifts: [{ code: 'M' }, { code: 'T' }, { code: 'N' }] },
  { positionName: 'P Rondín', qty: 1, coverageType: 'custom', shifts: [{ code: 'RO', startTime: '07:00' }] },
  { positionName: 'P Encargada', qty: 1, coverageType: 'custom', shifts: [{ code: 'EN', startTime: '07:00' }] },
];

const puestos2x1: PuestoServicio[] = puestos2x2.map((p) => (
  p.positionName.startsWith('Puesto') ? { ...p, qty: 1 } : p
));

function t(empId: string, nombre: string, code: string, positionName: string): TurnoDia {
  return { empId, nombre, code, positionName, hours: code === 'D12' || code === 'N12' ? 12 : 8, startTime: '07:00' };
}

/** Día 1 de Obrador: 6 M (2 custom) / 3 T / 4 N. */
function dia1(): TurnoDia[] {
  return [
    t('romero', 'ROMERO', 'RO', 'P Rondín'),
    t('goyochea', 'GOYOCHEA', 'EN', 'P Encargada'),
    t('videla', 'VIDELA', 'M', 'Puesto 1'),
    t('lopez', 'LOPEZ', 'M', 'Puesto 1'),
    t('araya', 'ARAYA', 'M', 'Puesto 2'),
    t('diaz', 'DIAZ', 'M', 'Puesto 2'),
    t('bordino', 'BORDINO', 'T', 'Puesto 1'),
    t('morales', 'MORALES', 'T', 'Puesto 2'),
    t('lucero', 'LUCERO ROMERO', 'T', 'Puesto 2'),
    t('kasianchuk', 'KASIANCHUK', 'N', 'Puesto 1'),
    t('martinez', 'MARTINEZ', 'N', 'Puesto 1'),
    t('palacios', 'PALACIOS', 'N', 'Puesto 2'),
    t('barrios', 'BARRIOS', 'N', 'Puesto 2'),
  ];
}

test('6 M (2 custom) / 3 T / 4 N contra 2 puestos × 2 pax: falta 1 T y no sobra banda', () => {
  const lectura = leerDia({ turnos: dia1(), puestos: puestos2x2 });
  assert.equal(lectura.falta.T, 1);
  assert.equal(lectura.falta.M, 0);
  assert.equal(lectura.falta.N, 0);
  assert.equal(lectura.sobra.M + lectura.sobra.T + lectura.sobra.N, 0);
  assert.equal(lectura.avisoServicio, null);
  assert.match(lectura.texto, /2 pax custom M \(Rondín, Encargada\)/);
  assert.match(lectura.texto, /falta 1 T/);
  assert.equal(lectura.custom[0].cantidad, 2);
});

test('el mismo día contra 2 puestos × 1 pax avisa que el servicio está desactualizado', () => {
  const lectura = leerDia({ turnos: dia1(), puestos: puestos2x1 });
  assert.match(lectura.avisoServicio || '', /2 pax por puesto/);
  assert.match(lectura.texto, /Sobran 40 h: 5 turnos de 8 h fuera del servicio/);
  assert.equal(lectura.turnosFuera, 5);
  assert.equal(lectura.horasVendidas, 48);
});

test('un turno sin puesto no se suma a Puesto 2', () => {
  const turnos = [
    ...dia1().filter((x) => x.empId !== 'palacios'),
    { empId: 'palacios', nombre: 'PALACIOS', code: 'N', hours: 8 },
  ];
  const lectura = leerDia({ turnos, puestos: puestos2x2 });
  assert.equal(lectura.sinPuesto.length, 1);
  assert.equal(lectura.sinPuesto[0].nombre, 'PALACIOS');
  assert.equal(lectura.cuentas.N, 3);
  const lugar = puestoConLugar('N', puestos2x2, turnos);
  assert.equal(lugar, 'Puesto 2');
});

test('D12 + N12 cuentan como un juego M+T+N', () => {
  const { cuentas } = contarEstandar([
    t('a', 'A', 'D12', 'Puesto 1'),
    t('b', 'B', 'N12', 'Puesto 1'),
  ]);
  assert.deepEqual(cuentas, { M: 1, T: 1, N: 1 });
});

test('falta 1 T propone M→D12 y N→N12 del mismo puesto, el de menos horas', () => {
  const puestos = [puestos2x2[0]];
  const turnos = dia1().filter((x) => x.positionName === 'Puesto 1');
  const turnos12: TurnoPuesto12[] = turnos.map((x) => ({
    empId: x.empId, nombre: x.nombre, dateStr: DIA, code: x.code, positionName: x.positionName || '',
  }));
  const faltantes = faltantesDelDia({
    dateStr: DIA,
    puestos,
    turnos,
    turnos12,
    horasMes: { videla: 40, lopez: 80, kasianchuk: 16, martinez: 90, bordino: 20 },
  });
  assert.equal(faltantes.length, 1);
  assert.equal(faltantes[0].banda, 'T');
  assert.equal(faltantes[0].consultarFranco, false);
  const codes = (faltantes[0].propuesta?.cambios || []).map((c) => `${c.nombre} ${c.code}`);
  assert.deepEqual(codes, ['VIDELA D12', 'KASIANCHUK N12']);
  assert.match(faltantes[0].texto, /VIDELA D12 \+ KASIANCHUK N12/);
});

test('sin par de 12 h ofrece consultar el franco y no asigna FT', () => {
  const puestos: PuestoServicio[] = [{ positionName: 'Puesto 1', qty: 1, coverageType: '24hs' }];
  const turnos = [t('solo', 'SOLO', 'M', 'Puesto 1')];
  const faltantes = faltantesDelDia({
    dateStr: DIA,
    puestos,
    turnos,
    turnos12: [{ empId: 'solo', nombre: 'SOLO', dateStr: DIA, code: 'M', positionName: 'Puesto 1' }],
    francos: [
      { empId: 'otro', nombre: 'OTRO', delObjetivo: false },
      { empId: 'franco', nombre: 'FRANCO', delObjetivo: true },
    ],
  });
  const tFalta = faltantes.find((f) => f.banda === 'T');
  assert.ok(tFalta);
  assert.equal(tFalta?.propuesta, null);
  assert.equal(tFalta?.consultarFranco, true);
  assert.equal(tFalta?.francos[0].nombre, 'FRANCO');
  assert.match(tFalta?.texto || '', /Consultar franco \(FT\)/);
});

test('liberar un M pasa el T y el N a 12 h y deja al liberado para RET', () => {
  const turnos: TurnoPuesto12[] = [
    { empId: 'diaz', nombre: 'DIAZ', dateStr: DIA, code: 'M', positionName: 'Puesto 1' },
    { empId: 'bordino', nombre: 'BORDINO', dateStr: DIA, code: 'T', positionName: 'Puesto 1' },
    { empId: 'palacios', nombre: 'PALACIOS', dateStr: DIA, code: 'N', positionName: 'Puesto 1' },
  ];
  const lib = proponerLiberar({ empId: 'diaz', dateStr: DIA, code: 'M', positionName: 'Puesto 1', turnos });
  assert.equal(lib.ok, true);
  if (!lib.ok) return;
  assert.deepEqual(lib.cambios.map((c) => `${c.nombre} ${c.code}`), ['BORDINO D12', 'PALACIOS N12']);
});

test('sin par válido no libera', () => {
  const turnos: TurnoPuesto12[] = [
    { empId: 'diaz', nombre: 'DIAZ', dateStr: DIA, code: 'M', positionName: 'Puesto 1' },
    { empId: 'bordino', nombre: 'BORDINO', dateStr: DIA, code: 'T', positionName: 'Puesto 1' },
  ];
  const lib = proponerLiberar({ empId: 'diaz', dateStr: DIA, code: 'M', positionName: 'Puesto 1', turnos });
  assert.equal(lib.ok, false);
});

test('un día vacío no lista bandas faltantes', () => {
  const faltantes = faltantesDelDia({
    dateStr: '2026-10-03',
    puestos: puestos2x1,
    turnos: [],
    turnos12: [],
  });
  assert.equal(faltantes.length, 0);
});

test('un par D12+N12 cubre una sola T: con dos puestos todavía falta la otra', () => {
  const puestos: PuestoServicio[] = [
    { positionName: 'Puesto 1', qty: 1, coverageType: '24hs' },
    { positionName: 'Puesto 2', qty: 1, coverageType: '24hs' },
  ];
  const turnos: TurnoDia[] = [
    t('a', 'A', 'M', 'Puesto 1'),
    t('b', 'B', 'N', 'Puesto 1'),
    t('c', 'C', 'D12', 'Puesto 1'),
    t('d', 'D', 'M', 'Puesto 2'),
    t('e', 'E', 'N12', 'Puesto 2'),
  ];
  const lectura = leerDia({ turnos, puestos });
  assert.equal(lectura.falta.M, 0);
  assert.equal(lectura.falta.N, 0);
  assert.equal(lectura.falta.T, 1);
  assert.equal(lectura.horasTrabajadas, 48);
  assert.equal(lectura.horasVendidas, 48);
  assert.match(lectura.texto, /falta 1 T/);
});

test('Obrador día 2: D12 cubre la M y no inventa una N; el par cierra la T de Puesto 2', () => {
  const puestos: PuestoServicio[] = [
    { positionName: 'Puesto 1', qty: 1, coverageType: '24hs' },
    { positionName: 'Puesto 2', qty: 1, coverageType: '24hs' },
  ];
  const base: TurnoDia[] = [
    t('bai', 'BAIGORRIA', 'M', 'Puesto 1'),
    t('otro', 'DIAZ', 'M', 'Puesto 1'),
    t('tarde', 'PEREZ', 'T', 'Puesto 1'),
    t('bar', 'BARRIOS CARRANZA', 'N', 'Puesto 1'),
    t('noche2', 'MARTINEZ', 'N', 'Puesto 1'),
    t('p2m', 'GOMEZ', 'M', 'Puesto 2'),
    t('p2n', 'LOPEZ', 'N', 'Puesto 2'),
  ];
  const conD12 = base.map((x) => (x.empId === 'bai' ? { ...x, code: 'D12' } : x));
  const soloD12 = leerDia({ turnos: conD12, puestos });
  assert.equal(soloD12.falta.M, 0);
  assert.equal(soloD12.falta.N, 0);
  assert.equal(soloD12.falta.T, 1);
  assert.match(soloD12.textoCorto, /falta T en Puesto 2/);
  assert.match(soloD12.textoCorto, /D12 de BAIGORRIA/);
  assert.match(soloD12.textoCorto, /BARRIOS/);
  assert.doesNotMatch(soloD12.textoCorto, /falta \d+ N/);
  const conPar = conD12.map((x) => (x.empId === 'bar' ? { ...x, code: 'N12' } : x));
  const cerrado = leerDia({ turnos: conPar, puestos });
  assert.equal(cerrado.falta.M, 0);
  assert.equal(cerrado.falta.T, 0);
  assert.equal(cerrado.falta.N, 0);
  assert.doesNotMatch(cerrado.textoCorto, /falta/);
});

test('un D12 solo no dice falta M; RO de una franja no pide T ni N', () => {
  const puestos: PuestoServicio[] = [
    { positionName: 'Puesto 1', qty: 1, coverageType: '24hs', shifts: [{ code: 'M' }, { code: 'T' }, { code: 'N' }] },
    { positionName: 'RO', qty: 1, coverageType: '24hs', shifts: [{ code: 'M', startTime: '07:00' }] },
  ];
  const lectura = leerDia({
    turnos: [t('a', 'A', 'D12', 'Puesto 1'), t('r', 'RONDIN', 'M', 'RO')],
    puestos,
  });
  assert.equal(lectura.falta.M, 0);
  assert.ok(lectura.falta.T >= 1);
  const faltantes = faltantesDelDia({
    dateStr: DIA,
    puestos,
    turnos: [t('a', 'A', 'D12', 'Puesto 1'), t('r', 'RONDIN', 'M', 'RO')],
    turnos12: [],
  });
  assert.equal(faltantes.some((f) => f.positionName === 'RO'), false);
  assert.equal(faltantes.some((f) => f.positionName === 'Puesto 1' && f.banda === 'M'), false);
});

test('exigeCobertura false no muestra sobrecobertura ni propone 12 h', () => {
  const puestos: PuestoServicio[] = [{ positionName: 'Puesto 1', qty: 1, coverageType: '24hs', exigeCobertura: false }];
  const lectura = leerDia({ turnos: [t('a', 'A', 'M', 'Puesto 1'), t('b', 'B', 'M', 'Puesto 1')], puestos });
  assert.equal(lectura.mostrar, false);
  assert.equal(lectura.sobranHoras, 0);
  const faltantes = faltantesDelDia({
    dateStr: DIA,
    puestos,
    turnos: [t('a', 'A', 'M', 'Puesto 1')],
    turnos12: [{ empId: 'a', nombre: 'A', dateStr: DIA, code: 'M', positionName: 'Puesto 1' }],
  });
  assert.equal(faltantes.length, 0);
});

test('EN y RO más 4 M / 4 T / 4 N contra 2 puestos × 2 pax: cierra sin horas de más', () => {
  const turnos = [...dia1(), t('regalo', 'REGALO', 'T', 'Puesto 1')];
  const lectura = leerDia({ turnos, puestos: puestos2x2 });
  assert.equal(lectura.falta.M + lectura.falta.T + lectura.falta.N, 0);
  assert.equal(lectura.sobranHoras, 0);
  assert.equal(lectura.turnosFuera, 0);
  assert.equal(lectura.horasVendidas, 96);
});
