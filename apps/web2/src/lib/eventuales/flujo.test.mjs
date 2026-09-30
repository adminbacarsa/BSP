import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { armarLote, bloqueoCruce, confirmarLote, planAsignacion, planSustitucion, turnoLiquidaEnEmpresa } from './flujo.mjs';

const bolsa = { cuil: '20999999991', empresasHabilitadas: ['bacarsa'] };
const vie = { fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
const dom = { fecha: '2026-10-04', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
const lunesAntesDelLote = Date.parse('2026-09-28T13:00:00.000Z');

describe('flujo operativo', () => {
  it('el planificador confirma un solo contrato vie+dom para la empresa convocante', () => {
    const plan = planAsignacion({ bolsa, empresaId: 'bacarsa', turnos: [vie, dom], ahoraMs: lunesAntesDelLote });
    assert.equal(plan.ok, true);
    assert.equal(plan.contrato.estado, 'CONFIRMADO');
    assert.equal(plan.contrato.empresaId, 'bacarsa');
    assert.equal(plan.contrato.fechaAlta, '2026-10-02');
    assert.equal(plan.contrato.fechaBaja, '2026-10-04');
    assert.equal(plan.contrato.jornadas.length, 2);
    assert.equal(plan.envioAt.canal, 'LOTE');
    assert.equal(planAsignacion({ bolsa, empresaId: 'grupos_bacar_sa', turnos: [vie] }).codigo, 'EMPRESA_NO_HABILITADA');
  });

  it('bloquea superposición y descanso menor a 12 h contra otra empresa', () => {
    const otra = { ...vie, empresaId: 'grupos_bacar_sa' };
    const sup = bloqueoCruce([vie], [otra]);
    assert.equal(sup.codigo, 'SUPERPOSICION');
    assert.match(sup.mensaje, /grupos_bacar_sa/);

    const noche = { fecha: '2026-10-01', horaInicio: '22:00', horaFin: '06:00', horas: 8, empresaId: 'grupos_bacar_sa' };
    const descanso = bloqueoCruce([vie], [noche]);
    assert.equal(descanso.codigo, 'DESCANSO_12H');
    assert.match(descanso.mensaje, /12 h/);
  });

  it('arma un TXT por empresa y un número de transacción para todo el lote', () => {
    const envios = [
      { id: 'a', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-A' },
      { id: 'b', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-B' },
      { id: 'c', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'URGENTE', txt: 'LINEA-C' },
      { id: 'd', empresaId: 'grupos_bacar_sa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-D' },
    ];
    const lote = armarLote({ empresaId: 'bacarsa', tipo: 'AT', envios });
    assert.deepEqual(lote.envioIds, ['a', 'b']);
    assert.equal(lote.txt, 'LINEA-A\nLINEA-B');
    const confirmados = confirmarLote(envios, { ...lote, id: 'lote-1' }, ' 7788 ');
    assert.equal(confirmados.find((e) => e.id === 'a').nroTransaccion, '7788');
    assert.equal(confirmados.find((e) => e.id === 'b').nroTransaccion, '7788');
    assert.equal(confirmados.find((e) => e.id === 'c').estado, 'PENDIENTE');
    assert.equal(confirmados.find((e) => e.id === 'd').empresaId, 'grupos_bacar_sa');
  });

  it('sacar antes de subir quita del lote; después pide anulación NA, marcada para el contador', () => {
    const antes = planSustitucion({
      envioTitular: { id: 'a', estado: 'PENDIENTE' },
      contratoTitular: { empresaId: 'bacarsa', fechaAlta: '2026-10-02' },
      sustituto: { cuil: '20888888881', empresasHabilitadas: ['bacarsa'] },
      turnos: [dom],
      ahoraMs: Date.parse('2026-10-01T15:00:00.000Z'),
    });
    assert.equal(antes.baja.accion, 'QUITAR_DEL_LOTE');
    assert.equal(antes.sustituto.ok, true);
    assert.equal(antes.sustituto.contrato.estado, 'CONFIRMADO');

    const despues = planSustitucion({
      envioTitular: { id: 'a', estado: 'CONFIRMADO' },
      contratoTitular: { empresaId: 'bacarsa', fechaAlta: '2026-10-02' },
      sustituto: null,
      turnos: [],
      ahoraMs: Date.parse('2026-10-02T15:00:00.000Z'),
    });
    assert.equal(despues.baja.movimiento, 'NA');
    assert.equal(despues.baja.confirmarConContador, true);

    const tarde = planSustitucion({
      envioTitular: { id: 'a', estado: 'CONFIRMADO' },
      contratoTitular: { empresaId: 'bacarsa', fechaAlta: '2026-10-02' },
      ahoraMs: Date.parse('2026-10-04T15:00:00.000Z'),
    });
    assert.equal(tarde.baja.accion, 'BAJA_FUERA_DE_PLAZO');
  });

  it('la liquidación de una empresa no toma el turno de la otra', () => {
    const turno = { empresaId: 'bacarsa', code: 'EV' };
    assert.equal(turnoLiquidaEnEmpresa(turno, 'bacarsa'), true);
    assert.equal(turnoLiquidaEnEmpresa(turno, 'grupos_bacar_sa'), false);
  });
});
