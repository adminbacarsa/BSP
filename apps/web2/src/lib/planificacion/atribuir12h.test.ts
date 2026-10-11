import assert from 'node:assert/strict';
import test from 'node:test';
import { elegirTitular, recalcularDia12, textoLicencia12, type CeldaDia12, type Licencia12 } from './atribuir12h';

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
  assert.equal(textoLicencia12(pending, {}, 'regalo', '2026-10-01'), 'cubierta por BAIGORRIA D12 + BARRIOS N12');
  assert.equal(textoLicencia12(pending, {}, 'otro', '2026-10-01'), '');
});
