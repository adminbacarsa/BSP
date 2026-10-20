import assert from 'node:assert/strict';
import test from 'node:test';
import { aplicarAtribucionAlGuardar, elegirTitular, indexar12, recalcularDia12, textoLicencia12, textoPata12, type CeldaDia12, type Licencia12 } from './atribuir12h';

const regalo: Licencia12 = {
  empId: 'regalo', nombre: 'REGALO, JUAN', code: 'ART', banda: 'T', positionName: 'Puesto 2', inicio: '2026-10-01', orden: 2,
};

function par(dia: Partial<CeldaDia12> & Pick<CeldaDia12, 'empId' | 'code'>): CeldaDia12 {
  return {
    nombre: dia.empId,
    orden: 0,
    coverageMode: '12H',
    coversBandCode: 'T',
    coversPositionName: 'Puesto 2',
    ...dia,
  };
}

test('una licencia ART de la T se atribuye a las dos patas', () => {
  const parches = recalcularDia12([
    { empId: 'regalo', nombre: 'REGALO, JUAN', code: 'ART', originalCode: 'T', positionName: 'Puesto 2', orden: 2, inicio: '2026-10-01' },
    par({ empId: 'baigorria', nombre: 'BAIGORRIA, LUIS', code: 'D12' }),
    par({ empId: 'barrios', nombre: 'BARRIOS, ANA', code: 'N12' }),
  ]);
  assert.equal(parches.length, 2);
  assert.ok(parches.every((p) => p.coversEmployeeId === 'regalo' && p.coversAbsenceCode === 'ART' && !p.limpiar));
  assert.match(parches[0].texto, /Cubre a REGALO \(ART\) · T · Puesto 2/);
});

test('dos licencias de bandas distintas: cada par va a la suya', () => {
  const celdas: CeldaDia12[] = [
    { empId: 'regalo', nombre: 'REGALO', code: 'ART', originalCode: 'T', positionName: 'Puesto 2', orden: 1, inicio: '2026-10-01' },
    { empId: 'lopez', nombre: 'LOPEZ', code: 'V', originalCode: 'M', positionName: 'Puesto 1', orden: 0, inicio: '2026-10-01' },
    par({ empId: 'a', code: 'D12', coversBandCode: 'T', coversPositionName: 'Puesto 2' }),
    par({ empId: 'b', code: 'N12', coversBandCode: 'T', coversPositionName: 'Puesto 2' }),
    par({ empId: 'c', code: 'D12', coversBandCode: 'M', coversPositionName: 'Puesto 1' }),
    par({ empId: 'd', code: 'N12', coversBandCode: 'M', coversPositionName: 'Puesto 1' }),
  ];
  const parches = recalcularDia12(celdas);
  const de = (id: string) => parches.find((p) => p.empId === id)!;
  assert.equal(de('a').coversEmployeeId, 'regalo');
  assert.equal(de('c').coversEmployeeId, 'lopez');
});

test('licencia de 5 días: cada día atribuye el par de ese día', () => {
  for (const puesto of ['Puesto 1', 'Puesto 2']) {
    const parches = recalcularDia12([
      { empId: 'regalo', nombre: 'REGALO', code: 'ART', originalCode: 'T', positionName: puesto, orden: 0, inicio: '2026-10-01' },
      par({ empId: 'd12', code: 'D12', coversPositionName: puesto }),
      par({ empId: 'n12', code: 'N12', coversPositionName: puesto }),
    ]);
    assert.ok(parches.every((p) => p.coversEmployeeId === 'regalo'), puesto);
  }
});

test('sin licencia la banda queda vacante', () => {
  const parches = recalcularDia12([
    par({ empId: 'a', code: 'D12' }),
    par({ empId: 'b', code: 'N12' }),
  ]);
  assert.ok(parches.every((p) => p.limpiar && /Banda vacante de Puesto 2/.test(p.texto)));
});

test('borrar la licencia suelta la atribución', () => {
  const con = recalcularDia12([
    { empId: 'regalo', nombre: 'REGALO', code: 'ART', originalCode: 'T', positionName: 'Puesto 2', orden: 0, inicio: '2026-10-01' },
    par({ empId: 'a', code: 'D12', coversEmployeeId: 'regalo' }),
  ]);
  assert.equal(con[0].limpiar, false);
  const sin = recalcularDia12([
    par({ empId: 'a', code: 'D12', coversEmployeeId: 'regalo' }),
  ]);
  assert.equal(sin[0].limpiar, true);
  assert.equal(sin[0].coversEmployeeId, '');
});

test('desempate: misma banda, mismo puesto, la que empezó antes, después el orden de fila', () => {
  const licencias: Licencia12[] = [
    { empId: 'tarde', nombre: 'TARDE', code: 'V', banda: 'T', positionName: 'Puesto 2', inicio: '2026-10-03', orden: 0 },
    { empId: 'antes', nombre: 'ANTES', code: 'ART', banda: 'T', positionName: 'Puesto 2', inicio: '2026-10-01', orden: 5 },
    { empId: 'otro', nombre: 'OTRO', code: 'E', banda: 'T', positionName: 'Puesto 1', inicio: '2026-09-01', orden: 0 },
  ];
  assert.equal(elegirTitular(licencias, 'T', 'Puesto 2')?.empId, 'antes');
  assert.equal(elegirTitular([licencias[0], licencias[2]], 'T', 'Puesto 9')?.empId, 'otro');
});

test('la marca de la licencia nombra a las dos patas', () => {
  const pending = {
    'a_2026-10-01': { code: 'D12', coverageMode: '12H', coversEmployeeId: 'regalo', employeeName: 'BAIGORRIA, LUIS' },
    'b_2026-10-01': { code: 'N12', coverageMode: '12H', coversEmployeeId: 'regalo', employeeName: 'BARRIOS, ANA' },
  };
  assert.equal(textoLicencia12(pending, {}, 'regalo', '2026-10-01'), 'BAIGORRIA D12 + BARRIOS N12 (12 h)');
  assert.equal(textoLicencia12(pending, {}, 'otro', '2026-10-01'), '');
});

test('V de BAIGORRIA del 10 al 23: el par tecleado se le atribuye y el día sin par no', () => {
  const pares: Record<number, [string, string, string, string]> = {
    12: ['regalo', 'REGALO, JUAN', 'herrante', 'HERRANTE, PEDRO'],
    13: ['diaz', 'DIAZ, ANA', 'araya', 'ARAYA, LUIS'],
    14: ['martinez', 'MARTINEZ, JOSE', 'kasianchuk', 'KASIANCHUK, IVAN'],
    15: ['palacios', 'PALACIOS, MARIA', 'araya', 'ARAYA, LUIS'],
    16: ['regalo', 'REGALO, JUAN', 'herrante', 'HERRANTE, PEDRO'],
    20: ['diaz', 'DIAZ, ANA', 'araya', 'ARAYA, LUIS'],
    23: ['palacios', 'PALACIOS, MARIA', 'kasianchuk', 'KASIANCHUK, IVAN'],
  };
  for (let d = 10; d <= 23; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    const celdas: CeldaDia12[] = [
      { empId: 'baigorria', nombre: 'BAIGORRIA, LUIS', code: 'V', originalCode: 'T', positionName: 'Puesto 1', orden: 0, inicio: '2026-10-10' },
    ];
    const par = pares[d];
    if (par) {
      celdas.push({ empId: par[0], nombre: par[1], code: 'D12', positionName: 'Puesto 1', orden: 1 });
      celdas.push({ empId: par[2], nombre: par[3], code: 'N12', positionName: 'Puesto 1', orden: 2 });
    }
    const parches = recalcularDia12(celdas);
    if (!par) {
      assert.equal(parches.length, 0, date);
      continue;
    }
    assert.equal(parches.length, 2, date);
    assert.ok(parches.every((p) => p.coversEmployeeId === 'baigorria' && p.coversAbsenceCode === 'V' && p.coverageMode === '12H' && p.coversBandCode === 'T' && p.coversPositionName === 'Puesto 1'), date);
    assert.match(parches[0].texto, /Cubre a BAIGORRIA \(V\) · T · Puesto 1/);
  }
  const pending: Record<string, { code: string; employeeName?: string; originalCode?: string; positionName?: string }> = {
    'baigorria_2026-10-12': { code: 'V', originalCode: 'T', positionName: 'Puesto 1', employeeName: 'BAIGORRIA, LUIS' },
    'regalo_2026-10-12': { code: 'D12', employeeName: 'REGALO, JUAN', positionName: 'Puesto 1' },
    'herrante_2026-10-12': { code: 'N12', employeeName: 'HERRANTE, PEDRO', positionName: 'Puesto 1' },
    'baigorria_2026-10-11': { code: 'V', originalCode: 'T', positionName: 'Puesto 1', employeeName: 'BAIGORRIA, LUIS' },
  };
  assert.equal(textoLicencia12(pending, {}, 'baigorria', '2026-10-12'), 'REGALO D12 + HERRANTE N12 (12 h)');
  assert.equal(textoLicencia12(pending, {}, 'baigorria', '2026-10-11'), '');
  assert.equal(textoPata12(pending, {}, 'regalo', '2026-10-12'), 'Cubre a BAIGORRIA (V) · T · Puesto 1');
  const guardado = aplicarAtribucionAlGuardar(pending, {}, {
    hm: (v) => String(v || '07:00'),
  });
  assert.equal(guardado['regalo_2026-10-12'].coverageMode, '12H');
  assert.equal(guardado['regalo_2026-10-12'].coversEmployeeId, 'baigorria');
  assert.equal(guardado['regalo_2026-10-12'].coversEmployeeName, 'BAIGORRIA, LUIS');
  assert.equal(guardado['herrante_2026-10-12'].coversBandCode, 'T');
  assert.equal(guardado['herrante_2026-10-12'].coversDateStr, '2026-10-12');
  assert.equal(guardado['herrante_2026-10-12'].coversPositionName, 'Puesto 1');
  assert.equal(guardado['baigorria_2026-10-11'], pending['baigorria_2026-10-11']);
});

test('un par cubre una sola licencia: gana la que empezó antes', () => {
  const parches = recalcularDia12([
    { empId: 'tarde', nombre: 'TARDE', code: 'V', originalCode: 'T', positionName: 'Puesto 1', orden: 0, inicio: '2026-10-12' },
    { empId: 'antes', nombre: 'ANTES, ANA', code: 'ART', originalCode: 'T', positionName: 'Puesto 1', orden: 5, inicio: '2026-10-01' },
    { empId: 'd', nombre: 'REGALO', code: 'D12', positionName: 'Puesto 1', orden: 2 },
    { empId: 'n', nombre: 'HERRANTE', code: 'N12', positionName: 'Puesto 1', orden: 3 },
  ]);
  assert.equal(parches.length, 2);
  assert.ok(parches.every((p) => p.coversEmployeeId === 'antes'));
});

test('cambiar el comienzo de la licencia recalcula la racha siguiente, no el mes', () => {
  const art = { code: 'ART', originalCode: 'T', positionName: 'Puesto 1', employeeName: 'ANTES, ANA' };
  const v = { code: 'V', originalCode: 'T', positionName: 'Puesto 1', employeeName: 'TARDE, LUIS' };
  const pata = (date: string, code: 'D12' | 'N12', nombre: string) => ({
    code,
    coverageMode: '12H',
    coversEmployeeId: 'antes',
    coversEmployeeName: 'ANTES, ANA',
    coversAbsenceCode: 'ART',
    coversBandCode: 'T',
    coversPositionName: 'Puesto 1',
    coversDateStr: date,
    employeeName: nombre,
  });
  const shifts: Record<string, any> = {};
  for (const d of ['01', '02', '03', '04']) {
    const date = `2026-10-${d}`;
    shifts[`antes_${date}`] = { ...art };
    shifts[`tarde_${date}`] = { ...v };
    shifts[`d_${date}`] = pata(date, 'D12', 'REGALO');
    shifts[`n_${date}`] = pata(date, 'N12', 'HERRANTE');
  }
  shifts['antes_2026-10-05'] = { code: 'F', employeeName: 'ANTES, ANA' };
  shifts['tarde_2026-10-05'] = { ...v };
  shifts['d_2026-10-05'] = pata('2026-10-05', 'D12', 'REGALO');
  shifts['n_2026-10-05'] = pata('2026-10-05', 'N12', 'HERRANTE');
  shifts['d_2026-10-20'] = pata('2026-10-20', 'D12', 'REGALO');
  const pending = {
    'antes_2026-10-01': { code: 'M', originalCode: 'T', positionName: 'Puesto 1', employeeName: 'ANTES, ANA' },
  };
  const guardado = aplicarAtribucionAlGuardar(pending, shifts);
  assert.equal(guardado['antes_2026-10-01'].code, 'M');
  for (const d of ['02', '03', '04']) {
    assert.equal(guardado[`d_2026-10-${d}`].coversEmployeeId, 'tarde', d);
    assert.equal(guardado[`n_2026-10-${d}`].coversEmployeeId, 'tarde', d);
    assert.equal(guardado[`d_2026-10-${d}`].coversAbsenceCode, 'V', d);
  }
  assert.equal(guardado['d_2026-10-05'], undefined);
  assert.equal(guardado['d_2026-10-20'], undefined);
});

test('textoLicencia12 con índice da lo mismo que sin índice', () => {
  const pending: Record<string, any> = {
    'baigorria_2026-10-12': { code: 'V', originalCode: 'T', positionName: 'Puesto 1', employeeName: 'BAIGORRIA, LUIS' },
    'regalo_2026-10-12': { code: 'D12', employeeName: 'REGALO, JUAN' },
    'herrante_2026-10-12': { code: 'N12', employeeName: 'HERRANTE, PEDRO', positionName: 'Puesto 1' },
    'perez_2026-10-13': { isDeleted: true },
  };
  const shifts: Record<string, any> = {
    'regalo_2026-10-10': { code: 'D12', positionName: 'Puesto 3' },
    'regalo_2026-10-12': { code: 'M' },
    'baigorria_2026-10-13': { code: 'V' },
    'perez_2026-10-13': { code: 'D12', coverageMode: '12H', coversEmployeeId: 'baigorria', employeeName: 'PEREZ' },
    'gomez_2026-10-13': { code: 'N12', coverageMode: '12H', coversEmployeeId: 'baigorria', employeeName: 'GOMEZ' },
  };
  const indice = indexar12(pending, shifts);
  for (const [t, d] of [['baigorria', '2026-10-12'], ['baigorria', '2026-10-13'], ['regalo', '2026-10-12'], ['x', '2026-10-14']]) {
    assert.equal(textoLicencia12(pending, shifts, t, d, { indice }), textoLicencia12(pending, shifts, t, d), `${t} ${d}`);
  }
});
