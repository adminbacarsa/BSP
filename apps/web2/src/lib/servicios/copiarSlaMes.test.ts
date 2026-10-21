import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateSlaHoursForMonth } from './slaHoursCalculator';
import { clasePrepararServicio, decidirCopiaSlaMes, partirCopiaMasiva, resumirCopias, type SlaParaCopiar } from './copiarSlaMes';

/** Colegio-like: N 23–08 son 9 h y el fin de semana es NE, no un N12 de 8 h. */
function puestoJe4v() {
  return {
    id: 'p-je4v',
    name: 'Vigilancia',
    coverageType: 'custom' as const,
    quantity: 1,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    trabajaFeriados: false,
    allowedShiftTypes: [
      { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8, days: ['L', 'M', 'X', 'J', 'V'] },
      { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8, days: ['L', 'M', 'X', 'J', 'V'] },
      { code: 'N', name: 'Noche', startTime: '23:00', endTime: '08:00', hours: 9, days: ['L', 'M', 'X', 'J', 'V'] },
      { code: 'NE', name: 'Noche finde', startTime: '23:00', endTime: '08:00', hours: 9, days: ['S', 'D'] },
    ],
  };
}

function firma(positions: unknown) {
  return (positions as Array<Record<string, unknown>>).map((p) => ({
    name: p.name,
    quantity: p.quantity,
    coverageType: p.coverageType,
    activeDays: p.activeDays,
    trabajaFeriados: p.trabajaFeriados,
    shifts: ((p.allowedShiftTypes || []) as Array<Record<string, unknown>>).map((s) => ({
      code: s.code,
      startTime: s.startTime,
      endTime: s.endTime,
      hours: s.hours,
      days: s.days,
    })),
  }));
}

function sla(partial: Record<string, unknown>): SlaParaCopiar {
  return {
    clientId: 'cli-claret',
    clientName: 'Colegio Padre Claret',
    objectiveId: 'obj-claret',
    objectiveName: 'Colegio Padre Claret',
    empresaId: 'bacarsa',
    status: 'active',
    closed: false,
    slaSeriesId: 'serie-claret',
    positions: [puestoJe4v()],
    billingMode: 'EJECUTADO',
    exigeCobertura: true,
    ...partial,
  };
}

describe('copia del servicio al mes siguiente', () => {
  it('copia idéntica de las franjas je4v a noviembre 2026 y recalcula las horas con −F', () => {
    const octubre = sla({ id: 'oct', startDate: '2026-10-01', endDate: '2026-10-31' });
    const antes = JSON.stringify(octubre.positions);
    const d = decidirCopiaSlaMes([octubre], '2026-11', { ahora: '2026-10-21T15:00:00.000Z' });
    assert.equal(d.accion, 'crear');
    if (d.accion !== 'crear') return;
    assert.equal(JSON.stringify(octubre.positions), antes);
    assert.equal(d.origenId, 'oct');
    assert.equal(d.mesOrigen, '2026-10');
    assert.equal(d.mesOrigenNombre, 'octubre');
    assert.equal(d.mesNombre, 'noviembre');
    assert.equal(d.doc.startDate, '2026-11-01');
    assert.equal(d.doc.endDate, '2026-11-30');
    assert.equal(d.doc.status, 'active');
    assert.equal(d.doc.closed, false);
    assert.equal(d.doc.clientId, 'cli-claret');
    assert.equal(d.doc.objectiveId, 'obj-claret');
    assert.equal(d.doc.empresaId, 'bacarsa');
    assert.equal(d.doc.slaSeriesId, 'serie-claret');
    assert.equal(d.serieNuevaEnOrigen, null);
    assert.deepEqual(firma(d.doc.positions), firma(octubre.positions));
    const noche = (d.doc.positions as Array<{ allowedShiftTypes: Array<{ code: string; endTime: string; hours: number }> }>)[0]
      .allowedShiftTypes.find((s) => s.code === 'N');
    const finde = (d.doc.positions as Array<{ allowedShiftTypes: Array<{ code: string; days: string[] }> }>)[0]
      .allowedShiftTypes.find((s) => s.code === 'NE');
    assert.equal(noche?.endTime, '08:00');
    assert.equal(noche?.hours, 9);
    assert.deepEqual(finde?.days, ['S', 'D']);
    const horas = calculateSlaHoursForMonth(
      d.doc.positions as never,
      '2026-11-01',
      '2026-11-30',
      undefined,
      2026,
      10,
    );
    assert.equal(d.doc.totalMonthlyHours, horas.total);
    assert.equal(d.doc.totalMonthlyHours, 581);
    const log = (d.doc.changeLog as Array<{ action: string; detail: string; at: string }>)[0];
    assert.equal(log.action, 'COPIA_MES_ANTERIOR');
    assert.equal(log.at, '2026-10-21T15:00:00.000Z');
    assert.match(log.detail, /octubre/);
    assert.match(log.detail, /oct/);
  });

  it('no duplica si ya hay un SLA que cubre el mes, aunque esté cerrado VENCIDO', () => {
    const octubre = sla({ id: 'oct', startDate: '2026-10-01', endDate: '2026-10-31' });
    const noviembre = sla({ id: 'nov', startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.equal(decidirCopiaSlaMes([octubre, noviembre], '2026-11').accion, 'existe');
    const vencido = sla({
      id: 'nov-v',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      status: 'active',
      closed: true,
      closedReason: 'VENCIDO',
    });
    assert.equal(decidirCopiaSlaMes([octubre, vencido], '2026-11').accion, 'existe');
    const inactivo = sla({ id: 'nov-x', startDate: '2026-11-01', endDate: '2026-11-30', status: 'inactive' });
    const libre = decidirCopiaSlaMes([octubre, inactivo], '2026-11');
    assert.equal(libre.accion, 'crear');
  });

  it('si falta el mes anterior el automático no crea; el manual copia el último y pide confirmación', () => {
    const julio = sla({ id: 'jul', startDate: '2026-07-01', endDate: '2026-07-31', slaSeriesId: '' });
    const agosto = sla({
      id: 'ago',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      slaSeriesId: undefined,
      positions: [puestoJe4v()],
      closed: true,
      closedReason: 'VENCIDO',
    });
    const auto = decidirCopiaSlaMes([julio, agosto], '2026-11', { modo: 'automatico', cliente: { status: 'ACTIVE' } });
    assert.equal(auto.accion, 'omitir');
    if (auto.accion !== 'omitir') return;
    assert.equal(auto.motivo, 'hueco');
    assert.equal(auto.mesOrigen, '2026-08');
    assert.match(auto.aviso, /noviembre no tiene servicio/);
    assert.match(auto.aviso, /agosto/);
    assert.match(auto.aviso, /cerrado\/vencido/);
    assert.match(auto.aviso, /Crealo desde Servicios o con el botón si sigue vigente/);
    const d = decidirCopiaSlaMes([julio, agosto], '2026-11', { modo: 'manual', seriesId: 'serie-nueva', cliente: { status: 'ACTIVE' } });
    assert.equal(d.accion, 'crear');
    if (d.accion !== 'crear') return;
    assert.equal(d.requiereConfirmacion, true);
    assert.equal(d.conHueco, true);
    assert.equal(d.origenCerrado, true);
    assert.equal(d.origenId, 'ago');
    assert.equal(d.mesOrigen, '2026-08');
    assert.equal(d.doc.slaSeriesId, 'serie-nueva');
    assert.equal(d.serieNuevaEnOrigen, 'serie-nueva');
    assert.equal(agosto.slaSeriesId, undefined);
    assert.deepEqual(firma(d.doc.positions), firma(agosto.positions));
    assert.deepEqual(resumirCopias([
      decidirCopiaSlaMes([agosto], '2026-11', { modo: 'manual', cliente: { status: 'ACTIVE' } }),
      decidirCopiaSlaMes([sla({ id: 'ya', startDate: '2026-11-01', endDate: '2026-11-30' })], '2026-11'),
      decidirCopiaSlaMes([], '2026-11'),
    ]), { creados: 1, yaExistian: 1, sinOrigen: 1 });
  });

  it('M-1 abierto crea automático; cliente inactivo o origen cerrado no', () => {
    const octubre = sla({ id: 'oct', startDate: '2026-10-01', endDate: '2026-10-31' });
    const activo = decidirCopiaSlaMes([octubre], '2026-11', { modo: 'automatico', cliente: { status: 'ACTIVE' } });
    assert.equal(activo.accion, 'crear');
    if (activo.accion === 'crear') assert.equal(activo.requiereConfirmacion, false);
    const inactivo = decidirCopiaSlaMes([octubre], '2026-11', { modo: 'automatico', cliente: { status: 'INACTIVE' } });
    assert.equal(inactivo.accion, 'omitir');
    if (inactivo.accion === 'omitir') assert.equal(inactivo.motivo, 'cliente_inactivo');
    assert.notEqual(decidirCopiaSlaMes([octubre], '2026-11', { cliente: { active: false } }).accion, 'crear');
    assert.notEqual(decidirCopiaSlaMes([octubre], '2026-11', { cliente: { isActive: false } }).accion, 'crear');
    const cerrado = sla({ id: 'oct-c', startDate: '2026-10-01', endDate: '2026-10-31', closed: true, closedReason: 'VENCIDO' });
    const no = decidirCopiaSlaMes([cerrado], '2026-11', { modo: 'automatico', cliente: { status: 'ACTIVO' } });
    assert.equal(no.accion, 'omitir');
    if (no.accion === 'omitir') {
      assert.equal(no.motivo, 'origen_cerrado');
      assert.equal(no.puedeManual, true);
      assert.match(no.aviso, /octubre \(cerrado\/vencido\)/);
    }
    const manual = decidirCopiaSlaMes([cerrado], '2026-11', { modo: 'manual', cliente: { status: 'ACTIVO' } });
    assert.equal(manual.accion, 'crear');
    if (manual.accion === 'crear') {
      assert.equal(manual.requiereConfirmacion, true);
      assert.equal(manual.conHueco, false);
      assert.match(manual.aviso, /cerrado\/vencido/);
    }
  });

  it('la copia masiva no crea huecos ni inactivos y Preparar los manda a fuera de operación', () => {
    const octubre = sla({ id: 'oct', startDate: '2026-10-01', endDate: '2026-10-31', objectiveName: 'Claret' });
    const agosto = sla({
      id: 'ago',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      closed: true,
      closedReason: 'VENCIDO',
      objectiveName: 'KEMPES',
    });
    const opts = { modo: 'manual' as const };
    const partido = partirCopiaMasiva([
      { nombre: 'Claret', decision: decidirCopiaSlaMes([octubre], '2026-11', { ...opts, cliente: { status: 'ACTIVE' } }) },
      { nombre: 'KEMPES', decision: decidirCopiaSlaMes([agosto], '2026-11', { ...opts, cliente: { status: 'INACTIVE' } }) },
      { nombre: 'Hueco', decision: decidirCopiaSlaMes([agosto], '2026-11', { ...opts, cliente: { status: 'ACTIVE' } }) },
      { nombre: 'Cerrado', decision: decidirCopiaSlaMes([sla({ id: 'oct-c', startDate: '2026-10-01', endDate: '2026-10-31', closed: true })], '2026-11', { ...opts, cliente: { status: 'ACTIVE' } }) },
    ]);
    assert.deepEqual(partido.aCrear.map((x) => x.nombre), ['Claret']);
    assert.deepEqual(partido.inactivos, ['KEMPES']);
    assert.deepEqual(partido.conHueco, ['Hueco']);
    assert.deepEqual(partido.cerrados, ['Cerrado']);
    assert.equal(clasePrepararServicio([agosto], '2026-11', { status: 'INACTIVE' }).clase, 'fuera');
    assert.equal(clasePrepararServicio([agosto], '2026-11', { status: 'ACTIVE' }).clase, 'fuera');
    assert.equal(clasePrepararServicio([octubre], '2026-11', { status: 'ACTIVE' }).clase, 'copiable');
    const octCerrado = sla({ id: 'oct-c', startDate: '2026-10-01', endDate: '2026-10-31', closed: true });
    assert.equal(clasePrepararServicio([octCerrado], '2026-11', { status: 'ACTIVE' }).clase, 'sin');
  });
});
