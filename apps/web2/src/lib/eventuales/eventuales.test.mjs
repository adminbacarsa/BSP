import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cuilCheckDigit, normalizeCuil } from './cuil.mjs';
import { planEfectivizacion, causaContratoValida } from './efectivizacion.mjs';
import { buildBolsaDoc, bolsaDocId, classifyEstadoActual, planImportRow, repetidosEnPlanilla } from './planilla.mjs';
import { fechaBajaDeJornadas, turnoDentroDeJornadas, validarJornadasContrato } from './jornadas.mjs';

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
    assert.equal(fuera.legajoExiste, true);
    assert.equal(fuera.indeterminadoConFecha, true);

    const activoNuevo = planImportRow({
      estadoRaw: '1. ACTIVO',
      cuilRaw: cuil,
      ingreso: '2026-02-15',
      matches: [],
    });
    assert.equal(activoNuevo.entraBolsa, true);
    assert.equal(activoNuevo.disponibilidad, 'DISPONIBLE');
    assert.equal(activoNuevo.arcaHistorial[0].estado, 'ALTA');
    assert.equal(activoNuevo.arcaHistorial[0].fecha, '2026-02-15');
    assert.equal('estadoArca' in activoNuevo, false);
    assert.equal(bolsaDocId(cuil), cuil);
    const ficha = buildBolsaDoc({ nombre: 'Persona', legajo: '100', ingreso: '2026-02-15' }, activoNuevo);
    assert.equal(ficha.cuil, cuil);
    assert.equal(ficha.legajoPlanilla, '100');
    assert.equal(ficha.createdBy, 'import-planilla-2026-09-29');
    assert.equal('employeeId' in ficha, false);
    assert.equal('estadoArca' in ficha, false);

    const baja = planImportRow({
      estadoRaw: '3. BAJA',
      cuilRaw: cuil,
      ingreso: '2025-01-01',
      fechaBaja: '2025-06-01',
      matches: [],
    });
    assert.equal(baja.disponibilidad, 'NO_DISPONIBLE');
    assert.equal(baja.arcaHistorial.map((h) => h.estado).join(','), 'ALTA,BAJA');
    assert.equal(baja.entraBolsa, false);
    const bajaSiEntra = planImportRow({
      estadoRaw: '3. BAJA',
      cuilRaw: cuil,
      ingreso: '2025-01-01',
      fechaBaja: '2025-06-01',
      matches: [],
      entraBolsaPorEstado: { BAJA: true },
    });
    assert.equal(bajaSiEntra.entraBolsa, true);

    const gol = planImportRow({
      estadoRaw: '4. GOLONDRINA',
      cuilRaw: cuil,
      ingreso: '2024-01-01',
      fechaBaja: '2024-08-01',
      matches: [],
    });
    assert.equal(gol.riesgoEncadenamiento, true);
    assert.equal('estadoArca' in gol, false);
    assert.equal(gol.disponibilidad, 'DISPONIBLE');
    assert.equal(gol.arcaHistorial.some((h) => h.estado === 'BAJA' && h.fecha === '2024-08-01'), true);

    const permanente = planImportRow({
      estadoRaw: '1. ACTIVO',
      cuilRaw: cuil,
      matches: [{ employeeId: 'e2', empresaId: 'bacarsa', modalidad: '', status: 'activo' }],
    });
    assert.equal(permanente.bucket, 'DUPLICADO_PLANTA');
    assert.equal(permanente.entraBolsa, false);
    assert.equal(permanente.porEmpresa.bacarsa, 'PLANTA_PERMANENTE');
    assert.equal(permanente.porEmpresa.pruebas_sa, 'NO_EXISTE');

    const enGrupo = planImportRow({
      estadoRaw: '1. ACTIVO',
      cuilRaw: cuil,
      matches: [{ employeeId: 'e3', empresaId: 'grupos_bacar_sa', modalidad: 'INDETERMINADO', status: 'activo' }],
    });
    assert.equal(enGrupo.bucket, 'DUPLICADO_PLANTA');
    assert.equal(enGrupo.entraBolsa, false);
    assert.equal(enGrupo.porEmpresa.grupos_bacar_sa, 'PLANTA_PERMANENTE');

    const flags = repetidosEnPlanilla([
      { legajo: '100', cuilRaw: cuil },
      { legajo: '100', cuilRaw: cuilValidoDesde('2011111111') },
    ]);
    assert.deepEqual(flags, [false, true]);

    assert.equal(planImportRow({ estadoRaw: '1. ACTIVO', cuilRaw: '20-1', matches: [] }).bucket, 'CUIL_INVALIDO');
  });
});

describe('jornadas del contrato', () => {
  const viernes = { fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
  const domingo = { fecha: '2026-10-04', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
  const domingoNoche = { fecha: '2026-10-04', horaInicio: '23:30', horaFin: '05:30', horas: 6 };

  it('la baja es el domingo, o el lunes si la jornada cruza medianoche', () => {
    assert.equal(fechaBajaDeJornadas([viernes, domingo]), '2026-10-04');
    assert.equal(fechaBajaDeJornadas([viernes, domingoNoche]), '2026-10-05');
  });

  it('el sábado dentro del período, sin jornada, no habilita un turno', () => {
    const jornadas = [viernes, domingo];
    assert.equal(turnoDentroDeJornadas(viernes, jornadas), true);
    assert.equal(turnoDentroDeJornadas({ fecha: '2026-10-03', horaInicio: '08:00', horaFin: '16:00' }, jornadas), false);
  });

  it('exige alta confirmada antes de la primera jornada, tope 12:59 y 12 h de descanso', () => {
    const ok = validarJornadasContrato([viernes, domingo], [], '2026-10-01');
    assert.equal(ok.ok, true);
    assert.equal(ok.fechaAlta, '2026-10-02');
    assert.equal(ok.fechaBaja, '2026-10-04');

    const sinAlta = validarJornadasContrato([viernes], [], null);
    assert.equal(sinAlta.errores.some((e) => e.codigo === 'ALTA_NO_CONFIRMADA'), true);

    const tarde = validarJornadasContrato([viernes], [], '2026-10-02T12:00:00-03:00');
    assert.equal(tarde.errores.some((e) => e.codigo === 'ALTA_DESPUES_DE_JORNADA'), true);

    const larga = { fecha: '2026-10-02', horaInicio: '06:00', horaFin: '20:00', horas: 14 };
    const tope = validarJornadasContrato([larga], [], '2026-10-01');
    assert.equal(tope.errores.some((e) => e.codigo === 'TOPE_JORNADA'), true);

    const otraEmpresa = { fecha: '2026-10-02', horaInicio: '18:00', horaFin: '23:00', horas: 5 };
    const descanso = validarJornadasContrato([domingo], [otraEmpresa], '2026-10-01');
    assert.equal(descanso.ok, true);
    const pegada = validarJornadasContrato(
      [{ fecha: '2026-10-04', horaInicio: '23:30', horaFin: '05:30', horas: 6 }],
      [{ fecha: '2026-10-05', horaInicio: '08:00', horaFin: '12:00', horas: 4 }],
      '2026-10-01',
    );
    assert.equal(pegada.errores.some((e) => e.codigo === 'DESCANSO_12H'), true);
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
    assert.equal(plan.bolsa.disponibilidad, 'NO_DISPONIBLE');
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
