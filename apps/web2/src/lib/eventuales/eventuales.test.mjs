import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cuilCheckDigit, normalizeCuil } from './cuil.mjs';
import { planEfectivizacion, causaContratoValida } from './efectivizacion.mjs';
import { classifyEstadoActual, planImportRow } from './planilla.mjs';

function cuilValidoDesde(first10) {
  return first10 + cuilCheckDigit(first10);
}

describe('CUIL', () => {
  it('acepta con guiones y rechaza verificador o largo inválido', () => {
    const digits = cuilValidoDesde('2099999999');
    assert.equal(normalizeCuil(`${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`), digits);
    assert.equal(normalizeCuil('20-123'), null);
    assert.equal(normalizeCuil(`${digits.slice(0, 10)}0`), null);
  });
});

describe('clasificación de planilla', () => {
  it('separa los cuatro estados y no manda efectivizados a la bolsa', () => {
    assert.equal(classifyEstadoActual('1. ACTIVO'), 'ACTIVO');
    assert.equal(classifyEstadoActual('2. EFECTIVIZADOS'), 'EFECTIVIZADO');
    assert.equal(classifyEstadoActual('3. BAJA'), 'BAJA');
    assert.equal(classifyEstadoActual('4. GOLONDRINA'), 'GOLONDRINA');

    const cuil = cuilValidoDesde('2711111111');
    const fuera = planImportRow({
      estadoRaw: '2. EFECTIVIZADOS',
      cuilRaw: cuil,
      matches: [{ employeeId: 'e1', empresaId: 'bacarsa', modalidad: 'INDETERMINADO', fechaEfectivizacion: '2024-03-01' }],
    });
    assert.equal(fuera.entraBolsa, false);
    assert.equal(fuera.creaLegajo, false);
    assert.equal(fuera.legajoExiste, true);
    assert.equal(fuera.indeterminadoConFecha, true);

    const activoNuevo = planImportRow({ estadoRaw: '1. ACTIVO', cuilRaw: cuil, matches: [] });
    assert.equal(activoNuevo.creaLegajo, true);
    assert.equal(activoNuevo.modalidadLegajo, 'EVENTUAL');
    assert.equal(activoNuevo.empresaAlta, 'bacarsa');

    const activoExiste = planImportRow({
      estadoRaw: '1. ACTIVO',
      cuilRaw: cuil,
      matches: [{ employeeId: 'e2', empresaId: 'bacarsa' }],
    });
    assert.equal(activoExiste.creaLegajo, false);
    assert.equal(activoExiste.legajoExiste, true);

    const baja = planImportRow({ estadoRaw: '3. BAJA', cuilRaw: cuil, matches: [] });
    assert.equal(baja.bolsaEstado, 'BAJA');
    assert.equal(baja.asignable, false);
    assert.equal(baja.creaLegajo, false);

    const gol = planImportRow({ estadoRaw: '4. GOLONDRINA', cuilRaw: cuil, matches: [] });
    assert.equal(gol.riesgoEncadenamiento, true);
    assert.equal(gol.entraBolsa, true);
    assert.equal(gol.creaLegajo, false);

    assert.equal(planImportRow({ estadoRaw: '1. ACTIVO', cuilRaw: '20-1', matches: [] }).bucket, 'CUIL_INVALIDO');
  });
});

describe('efectivización', () => {
  const cuil = cuilValidoDesde('2033333333');
  const base = {
    empresaId: 'bacarsa',
    employeeId: 'leg-1',
    bolsaCuil: cuil,
    primerIngreso: '2024-01-15',
    fecha: '2026-09-01',
    modalidadActual: 'EVENTUAL',
    setByUid: 'rrhh',
    nowIso: '2026-09-29T15:00:00.000Z',
    contratos: [
      { id: 'c1', empresaId: 'bacarsa', estado: 'VIGENTE', status: 'ACTIVE' },
      { id: 'c2', empresaId: 'bacarsa', estado: 'FINALIZADO', status: 'ACTIVE' },
      { id: 'c3', empresaId: 'grupos_bacar_sa', estado: 'VIGENTE', status: 'ACTIVE' },
    ],
    bolsaLegajos: [{ empresaId: 'bacarsa', employeeId: 'leg-1', modalidad: 'EVENTUAL' }],
  };

  it('mismo legajo, antigüedad desde el 1º ingreso, cierra contratos y sale de la bolsa', () => {
    const plan = planEfectivizacion(base);
    assert.equal(plan.ok, true);
    assert.equal(plan.legajo.employeeId, 'leg-1');
    assert.equal(plan.legajo.modalidad, 'INDETERMINADO');
    assert.equal(plan.legajo.fechaEfectivizacion, '2026-09-01');
    assert.equal(plan.legajo.startDate, '2024-01-15');
    assert.equal(plan.legajo.historyItem.motivo, 'EFECTIVIZACION');
    assert.deepEqual(plan.contratosCerrados.map((c) => c.id), ['c1']);
    assert.equal(plan.contratosCerrados[0].arcaBajaPendiente, true);
    assert.equal(plan.bolsa.accion, 'SALIR');
    assert.equal(plan.bolsa.asignable, false);
    assert.equal(plan.arca.tipo, 'MODIFICACION_MODALIDAD');
    assert.equal(plan.arca.estado, 'PENDIENTE');
  });

  it('si sigue eventual en la otra empresa, solo quita ese vínculo', () => {
    const plan = planEfectivizacion({
      ...base,
      bolsaLegajos: [
        { empresaId: 'bacarsa', employeeId: 'leg-1', modalidad: 'EVENTUAL' },
        { empresaId: 'grupos_bacar_sa', employeeId: 'leg-2', modalidad: 'EVENTUAL' },
      ],
    });
    assert.equal(plan.bolsa.accion, 'QUITAR_LEGAJO');
    assert.equal(plan.bolsa.legajos.length, 1);
    assert.equal(plan.bolsa.legajos[0].empresaId, 'grupos_bacar_sa');
  });

  it('rechaza quien ya es indeterminado y una causa vacía', () => {
    assert.equal(planEfectivizacion({ ...base, modalidadActual: 'INDETERMINADO' }).error, 'NO_ES_EVENTUAL');
    assert.equal(causaContratoValida('  '), false);
    assert.equal(causaContratoValida('Pico de demanda en el objetivo'), true);
  });
});
