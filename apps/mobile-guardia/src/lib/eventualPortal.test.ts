/**
 * Eventual en la app (docs/EVENTUALES-DISENO.md §7): claim, contratos, credencial y gate ARCA.
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/eventualPortal.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bolsaCuilFromClaims,
  clasificarContratoEventual,
  contratoVigenteParaCredencial,
  credencialContratoPublico,
  empresaLabelDeTurno,
  formatBrutoArs,
  horasContrato,
  isEventualClaims,
  legajoParaEmpresa,
  periodoContratoLabel,
  puedeAcusarRecibo,
  sinDatosSensibles,
  turnoEsDelEventual,
  type ContratoEventualPortal,
  type EventualLegajo,
} from '../../../../packages/portal-core/src/eventuales/eventualPortal';
import {
  evaluateCheckInWindow,
  isAltaArcaConfirmada,
  ALTA_ARCA_PENDIENTE_MESSAGE,
} from '../../../../packages/portal-core/src/checkIn/evaluateCheckInWindow';
import { getCheckInTiming } from '../../../../packages/portal-core/src/checkIn/portalCheckIn';
import { resolveCheckInUiStatus } from '../../../../packages/portal-core/src/checkIn/checkInUiStatus';
import { ACUSE_NO_DISPONIBLE_MESSAGE, isCallableMissingError } from './acusarReciboContratoState';

const HOY = '2026-09-30';

const legajos: EventualLegajo[] = [
  { empresaId: 'emp_a', employeeId: 'leg_a', empresaNombre: 'Bacar SA' },
  { empresaId: 'emp_b', employeeId: 'leg_b', empresaNombre: 'Cosp Seguridad' },
];

describe('claim EVENTUAL', () => {
  it('detecta role/type eventual y el CUIL de la bolsa', () => {
    assert.equal(isEventualClaims({ role: 'EVENTUAL', type: 'eventual', bolsaCuil: '20123456789' }), true);
    assert.equal(isEventualClaims({ type: 'eventual' }), true);
    assert.equal(isEventualClaims({ role: 'EMPLOYEE' }), false);
    assert.equal(isEventualClaims(null), false);
    assert.equal(bolsaCuilFromClaims({ bolsaCuil: ' 20123456789 ' }), '20123456789');
    assert.equal(bolsaCuilFromClaims({}), null);
  });
});

describe('contratos eventuales', () => {
  const vigente: ContratoEventualPortal = {
    id: 'emp_a_20123456789_2026-09',
    empresaId: 'emp_a',
    employeeId: 'leg_a',
    estado: 'CONFIRMADO',
    fechaAlta: '2026-09-20',
    fechaBaja: '2026-10-02',
    jornadas: [
      { fecha: '2026-09-28', horaInicio: '06:00', horaFin: '14:00', horas: 8 },
      { fecha: '2026-10-01', horaInicio: '06:00', horaFin: '18:00', horas: 12 },
    ],
    brutoEstimado: 250000,
  };

  it('clasifica vigente / pasado / borrador', () => {
    assert.equal(clasificarContratoEventual(vigente, HOY), 'VIGENTE');
    assert.equal(clasificarContratoEventual({ ...vigente, fechaBaja: '2026-09-29' }, HOY), 'PASADO');
    assert.equal(clasificarContratoEventual({ ...vigente, estado: 'FINALIZADO' }, HOY), 'PASADO');
    assert.equal(clasificarContratoEventual({ ...vigente, estado: 'ANULADO' }, HOY), 'PASADO');
    assert.equal(clasificarContratoEventual({ ...vigente, estado: 'BORRADOR' }, HOY), 'BORRADOR');
    assert.equal(clasificarContratoEventual({ ...vigente, status: 'INACTIVE' }, HOY), 'PASADO');
  });

  it('acuse: una vez, solo vigente y con documento', () => {
    assert.equal(puedeAcusarRecibo(vigente, HOY), true);
    assert.equal(puedeAcusarRecibo({ ...vigente, acuse: { at: new Date(), uid: 'u1' } }, HOY), false);
    assert.equal(puedeAcusarRecibo({ ...vigente, estado: 'ACUSE_RECIBIDO' }, HOY), false);
    assert.equal(puedeAcusarRecibo({ ...vigente, estado: 'BORRADOR' }, HOY), false);
    assert.equal(puedeAcusarRecibo({ ...vigente, fechaBaja: '2026-09-01' }, HOY), false);
  });

  it('período, jornadas y bruto para la tarjeta', () => {
    assert.equal(periodoContratoLabel(vigente), '20/09/2026 – 02/10/2026');
    assert.equal(periodoContratoLabel({ fechaAlta: '2026-09-20', fechaBaja: '2026-09-20' }), '20/09/2026');
    assert.equal(horasContrato(vigente), 20);
    assert.equal(formatBrutoArs(undefined), null);
    assert.equal(formatBrutoArs(0), null);
    assert.match(formatBrutoArs(250000) || '', /250\.000/);
  });

  it('la credencial toma el vigente que empieza antes y no expone datos sensibles', () => {
    const otro: ContratoEventualPortal = {
      ...vigente,
      id: 'emp_b_20123456789_2026-10',
      empresaId: 'emp_b',
      fechaAlta: '2026-09-25',
      fechaBaja: '2026-10-05',
    };
    const pasado: ContratoEventualPortal = { ...vigente, id: 'old', fechaAlta: '2026-08-01', fechaBaja: '2026-08-10' };
    const elegido = contratoVigenteParaCredencial([otro, pasado, vigente], HOY);
    assert.equal(elegido?.id, vigente.id);

    const pub = credencialContratoPublico(elegido, 'Bacar SA');
    assert.deepEqual(pub, {
      empresaId: 'emp_a',
      empresaNombre: 'Bacar SA',
      fechaAlta: '2026-09-20',
      fechaBaja: '2026-10-02',
      estado: 'Confirmado',
    });
    assert.equal(credencialContratoPublico(null, 'X'), null);

    const recorte = sinDatosSensibles({
      empresaNombre: 'Bacar SA',
      contratoVigente: pub,
      domicilio: 'Calle 123',
      direccion: 'Otra',
      sueldo: 1,
      brutoEstimado: 250000,
      telefono: '351',
      email: 'a@b.c',
    });
    assert.deepEqual(Object.keys(recorte).sort(), ['contratoVigente', 'empresaNombre']);
    assert.equal(JSON.stringify(recorte).includes('Calle 123'), false);
    assert.equal(JSON.stringify(recorte).includes('250000'), false);
  });
});

describe('turnos de varias empresas', () => {
  it('etiqueta de empresa por empresaId o por legajo dueño', () => {
    assert.equal(empresaLabelDeTurno({ empresaId: 'emp_b' }, legajos), 'Cosp Seguridad');
    assert.equal(empresaLabelDeTurno({ employeeId: 'leg_a' }, legajos), 'Bacar SA');
    assert.equal(empresaLabelDeTurno({ empresaId: 'emp_a' }, legajos, { emp_a: 'BACAR S.A.' }), 'BACAR S.A.');
    assert.equal(empresaLabelDeTurno({ empresaId: 'emp_z' }, legajos), 'emp_z');
    assert.equal(empresaLabelDeTurno({}, legajos), null);
  });

  it('el turno pertenece al eventual si es de alguno de sus legajos', () => {
    assert.equal(turnoEsDelEventual({ employeeId: 'leg_b' }, legajos, 'uid1'), true);
    assert.equal(turnoEsDelEventual({ employeeId: 'uid1' }, legajos, 'uid1'), true);
    assert.equal(turnoEsDelEventual({ employeeId: 'otro' }, legajos, 'uid1'), false);
    assert.equal(turnoEsDelEventual({}, legajos, 'uid1'), false);
  });

  it('legajo para la empresa del contrato, con fallback al primero', () => {
    assert.equal(legajoParaEmpresa(legajos, 'emp_b')?.employeeId, 'leg_b');
    assert.equal(legajoParaEmpresa(legajos, 'emp_zzz')?.employeeId, 'leg_a');
    assert.equal(legajoParaEmpresa([], 'emp_a'), null);
  });
});

describe('gate ALTA_ARCA_PENDIENTE (espejo del servidor)', () => {
  const start = new Date('2026-09-30T06:00:00-03:00');
  const end = new Date('2026-09-30T14:00:00-03:00');
  const base = { id: 't1', employeeId: 'leg_a', empresaId: 'emp_a', startTime: start, endTime: end };

  it('isAltaArcaConfirmada: solo bloquea eventual sin confirmación', () => {
    assert.equal(isAltaArcaConfirmada({ ...base }), true);
    assert.equal(isAltaArcaConfirmada({ ...base, esEventual: true, eventualAltaArcaConfirmada: true }), true);
    assert.equal(isAltaArcaConfirmada({ ...base, esEventual: true }), false);
    assert.equal(isAltaArcaConfirmada({ ...base, esEventual: true, eventualAltaArcaConfirmada: false }), false);
  });

  it('evaluateCheckInWindow rechaza primero por ARCA aun dentro de la ventana', () => {
    const now = new Date('2026-09-30T05:55:00-03:00');
    const ok = evaluateCheckInWindow({ ...base, esEventual: true, eventualAltaArcaConfirmada: true }, now.getTime());
    assert.equal(ok.allowed, true);
    const ko = evaluateCheckInWindow({ ...base, esEventual: true }, now.getTime());
    assert.equal(ko.allowed, false);
    assert.equal(ko.rejectCode, 'ALTA_ARCA_PENDIENTE');
  });

  it('la tarjeta dice «Alta en trámite» y no ofrece botón de fichar', () => {
    const now = new Date('2026-09-30T05:55:00-03:00');
    const shift = { ...base, esEventual: true, eventualAltaArcaConfirmada: false };
    const timing = getCheckInTiming(shift as never, now);
    assert.equal(timing.canCheckIn, false);
    assert.equal(timing.rejectCode, 'ALTA_ARCA_PENDIENTE');
    assert.equal(timing.rejectMessage, ALTA_ARCA_PENDIENTE_MESSAGE);
    const view = resolveCheckInUiStatus(shift as never, timing);
    assert.equal(view.status, 'blocked');
    assert.match(view.title, /Alta en trámite — no podés fichar todavía/);
    assert.equal(view.actionLabel, undefined);

    const confirmado = getCheckInTiming({ ...shift, eventualAltaArcaConfirmada: true } as never, now);
    assert.equal(confirmado.canCheckIn, true);
  });
});

describe('acuse de recibo — servidor sin callable', () => {
  it('detecta not-found / unimplemented y deja el mensaje preparado', () => {
    assert.equal(isCallableMissingError({ code: 'functions/not-found', message: 'not found' }), true);
    assert.equal(isCallableMissingError({ code: 'functions/unimplemented' }), true);
    assert.equal(isCallableMissingError({ code: 'functions/failed-precondition', message: 'Contrato anulado' }), false);
    assert.equal(isCallableMissingError({ code: 'functions/internal', message: 'internal' }), false);
    assert.match(ACUSE_NO_DISPONIBLE_MESSAGE, /no está habilitado/);
  });
});
