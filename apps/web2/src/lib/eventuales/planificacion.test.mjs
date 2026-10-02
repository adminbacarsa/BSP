import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jornadasDeTurnos, planContratoDesdeTurnos, turnoAJornada, vencimientosDe } from './planificacion.mjs';
import { armarLote } from './flujo.mjs';

// Los casos de candidatos (motor único `eventualesParaHueco`) están en candidatosUnificados.test.mjs.
const hoy = '2026-10-01';
const bolsa = {
  cuil: '20999999991', nombre: 'PEREZ, JUAN', disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['bacarsa'],
  domicilioGeo: { lat: '-31.42', lon: '-64.18' }, credencialVencimiento: '2027-01-01', aptoPsicofisico: { vencimiento: '2026-10-20' },
  habilitacion9236: { vencimiento: '2027-06-01' }, confiabilidad: 90,
  marcos: { bacarsa: { firmado: true, fechaFirma: '2026-01-01', vigenciaDias: 365 } },
};

// 07:00 AR = 10:00Z
const ts = (iso) => ({ seconds: Date.parse(iso) / 1000, nanoseconds: 0 });
const turno = (over = {}) => ({
  id: 't1', empresaId: 'bacarsa', objectiveId: 'obj1', code: 'M', hours: 8, draft: true,
  startTime: ts('2026-10-05T10:00:00.000Z'), endTime: ts('2026-10-05T18:00:00.000Z'), ...over,
});

describe('vencimientos de la ficha', () => {
  it('credencial, apto y habilitación con OK / PRONTO / VENCIDO / SIN_DATO', () => {
    assert.deepEqual(vencimientosDe(bolsa, hoy).map((v) => [v.tipo, v.estado]), [['credencial', 'OK'], ['apto', 'PRONTO'], ['habilitacion', 'OK']]);
    assert.equal(vencimientosDe({ ...bolsa, credencialVencimiento: '2026-09-01' }, hoy)[0].estado, 'VENCIDO');
    assert.equal(vencimientosDe({}, hoy)[2].estado, 'SIN_DATO');
  });
});

describe('turno → jornada', () => {
  it('convierte Timestamp a fecha/hora AR y descarta licencias', () => {
    const j = turnoAJornada(turno());
    assert.deepEqual([j.fecha, j.horaInicio, j.horaFin, j.horas, j.publicada], ['2026-10-05', '07:00', '15:00', 8, false]);
    assert.equal(turnoAJornada(turno({ code: 'V' })), null);
    assert.equal(turnoAJornada(turno({ isUnassigned: true })), null);
    const n = turnoAJornada(turno({ code: 'N', startTime: ts('2026-10-06T02:00:00.000Z'), endTime: ts('2026-10-06T10:00:00.000Z') }));
    assert.deepEqual([n.fecha, n.horaInicio, n.horaFin], ['2026-10-05', '23:00', '07:00']);
    assert.equal(jornadasDeTurnos([turno({ id: 'b', startTime: ts('2026-10-07T10:00:00.000Z'), endTime: ts('2026-10-07T18:00:00.000Z') }), turno()])[0].turnoId, 't1');
  });
});

describe('contrato desde turnos', () => {
  const ahora = Date.parse('2026-10-01T13:00:00.000Z');

  it('cronograma en borrador → contrato BORRADOR sin envío', () => {
    const r = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, employeeId: 'e1', turnos: [turno()], ahoraMs: ahora });
    assert.equal(r.accion, 'CREAR');
    assert.equal(r.contrato.estado, 'BORRADOR');
    assert.equal(r.contrato.fechaAlta, '2026-10-05');
    assert.equal(r.envios.length, 0);
  });

  it('al publicar → CONFIRMADO y entra al lote AT', () => {
    const borrador = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno()], ahoraMs: ahora }).contrato;
    const r = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false })], contratoActual: borrador, ahoraMs: ahora });
    assert.equal(r.accion, 'ACTUALIZAR');
    assert.equal(r.contrato.estado, 'CONFIRMADO');
    assert.equal(r.envios.length, 1);
    assert.equal(r.envios[0].tipo, 'AT');
    assert.equal(r.envios[0].canal, 'LOTE');
    const lote = armarLote({ empresaId: 'bacarsa', tipo: 'AT', envios: [{ id: 'x', ...r.envios[0], txt: 'L' }] });
    assert.equal(lote.lineas, 1);
  });

  it('mes publicado: nuevo turno agrega jornada y, con AT subido, cambia fechas → MR', () => {
    const confirmado = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false })], ahoraMs: ahora }).contrato;
    const at = { id: 'at1', tipo: 'AT', estado: 'CONFIRMADO', fechaAlta: '2026-10-05', fechaBaja: '2026-10-05' };
    const extra = turno({ id: 't2', draft: false, startTime: ts('2026-10-08T10:00:00.000Z'), endTime: ts('2026-10-08T18:00:00.000Z') });
    const r = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false }), extra], contratoActual: confirmado, enviosActuales: [at], ahoraMs: ahora });
    assert.equal(r.contrato.jornadas.length, 2);
    assert.equal(r.contrato.fechaBaja, '2026-10-08');
    assert.deepEqual(r.envios.map((e) => e.tipo), ['MR']);
    const igual = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false }), extra], contratoActual: r.contrato, enviosActuales: [at, { id: 'mr', ...r.envios[0] }], ahoraMs: ahora });
    assert.equal(igual.accion, 'SIN_CAMBIOS');
  });

  it('AT pendiente y cambian fechas → se corrige el envío sin MR', () => {
    const confirmado = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false })], ahoraMs: ahora }).contrato;
    const at = { id: 'at1', tipo: 'AT', estado: 'PENDIENTE', fechaAlta: '2026-10-05', fechaBaja: '2026-10-05' };
    const extra = turno({ id: 't2', draft: false, startTime: ts('2026-10-08T10:00:00.000Z'), endTime: ts('2026-10-08T18:00:00.000Z') });
    const r = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false }), extra], contratoActual: confirmado, enviosActuales: [at], ahoraMs: ahora });
    assert.equal(r.envios.length, 0);
    assert.deepEqual(r.patchesEnvios[0], { id: 'at1', patch: { fechaAlta: '2026-10-05', fechaBaja: '2026-10-08', regenerarTxt: true } });
  });

  it('quitar todos los turnos: AT sin subir sale del lote; subido → anulación el mismo día, baja después', () => {
    const confirmado = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false })], ahoraMs: ahora }).contrato;
    const pend = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [], contratoActual: confirmado, enviosActuales: [{ id: 'at1', tipo: 'AT', estado: 'PENDIENTE' }], ahoraMs: ahora });
    assert.equal(pend.contrato.estado, 'ANULADO');
    assert.equal(pend.patchesEnvios[0].patch.quitadoDelLote, true);
    assert.equal(armarLote({ empresaId: 'bacarsa', tipo: 'AT', envios: [{ id: 'at1', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', quitadoDelLote: true }] }).lineas, 0);
    const na = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [], contratoActual: confirmado, enviosActuales: [{ id: 'at1', tipo: 'AT', estado: 'CONFIRMADO' }], ahoraMs: Date.parse('2026-10-05T12:00:00.000Z') });
    assert.equal(na.envios[0].tipo, 'ANULACION');
    assert.equal(na.envios[0].motivo, null);
    assert.equal(na.envios[0].lote, 'ANULACION');
    assert.equal(na.envios[0].carga, 'MANUAL_WEB');
    assert.equal(na.envios[0].enviable, false);
    assert.equal(na.envios[0].txt, null);
    assert.equal(na.contrato.estado, 'ANULADO');
    const bt = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [], contratoActual: confirmado, enviosActuales: [{ id: 'at1', tipo: 'AT', estado: 'CONFIRMADO' }], ahoraMs: Date.parse('2026-10-07T12:00:00.000Z') });
    assert.equal(bt.envios[0].tipo, 'BAJA_NO_PRESENTACION');
    assert.equal(bt.envios[0].fechaBaja, '2026-10-05');
    assert.equal(bt.envios[0].motivo, 'desistimiento / sin efectivización de tareas');
    assert.equal(bt.envios[0].observacionesInternas, 'Sin efectivización de tareas / No presentación al primer turno');
    assert.equal(bt.envios[0].bruto, 0);
    assert.equal(bt.envios[0].sinDevengamiento, true);
    assert.equal(bt.envios[0].devengaArt, false);
    assert.equal(bt.contrato.estado, 'FINALIZADO');
  });

  it('despublicar con AT ya subido no anula; sin subir vuelve a BORRADOR', () => {
    const confirmado = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ draft: false })], ahoraMs: ahora }).contrato;
    const subido = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno()], contratoActual: confirmado, enviosActuales: [{ id: 'at1', tipo: 'AT', estado: 'CONFIRMADO' }], ahoraMs: ahora });
    assert.equal(subido.accion, 'SIN_CAMBIOS');
    const pend = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno()], contratoActual: confirmado, enviosActuales: [{ id: 'at1', tipo: 'AT', estado: 'PENDIENTE' }], ahoraMs: ahora });
    assert.equal(pend.contrato.estado, 'BORRADOR');
    assert.equal(pend.patchesEnvios[0].patch.quitadoMotivo, 'CRONOGRAMA_BORRADOR');
  });

  it('solo cuenta turnos de la empresa del contrato', () => {
    const r = planContratoDesdeTurnos({ empresaId: 'bacarsa', bolsa, turnos: [turno({ empresaId: 'grupos_bacar_sa', draft: false })], ahoraMs: ahora });
    assert.equal(r.accion, 'SIN_CAMBIOS');
    assert.equal(r.contrato, null);
  });
});
