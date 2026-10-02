import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOPE_HORAS_DEFAULT, TOPE_MARGEN_DEFAULT, chipTope, evaluarJornadasContraTope, evaluarTope, horasComprometidas, motivoCercaTope, motivoTopeHoras,
  normalizarMargen, normalizarTope, rangoPeriodo, textoOcultosPorTope, topeEfectivo, turnoCuentaParaTope,
} from './topeHoras.mjs';

const emp = 'bacarsa';
const ev = (fecha, horas, extra = {}) => ({
  id: `${fecha}_${horas}_${extra.horaInicio || '08:00'}`,
  empresaId: emp, esEventual: true, scheduleDate: fecha, hours: horas, horaInicio: extra.horaInicio || '08:00',
  ...extra,
});

describe('tope de horas del eventual', () => {
  it('el mes calendario es 1 → fin, y el ciclo de liquidación es 26 → 25', () => {
    assert.deepEqual(
      { ...rangoPeriodo('2026-10-02', 'CALENDARIO'), clave: undefined, desde: rangoPeriodo('2026-10-02', 'CALENDARIO').desde, hasta: rangoPeriodo('2026-10-02', 'CALENDARIO').hasta },
      { desde: '2026-10-01', hasta: '2026-10-31', clave: undefined },
    );
    assert.equal(rangoPeriodo('2026-10-02', 'CALENDARIO').hasta, '2026-10-31');
    assert.equal(rangoPeriodo('2026-02-10', 'CALENDARIO').hasta, '2026-02-28');
    const ciclo = rangoPeriodo('2026-10-02', 'CICLO_26_25');
    assert.equal(ciclo.desde, '2026-09-26');
    assert.equal(ciclo.hasta, '2026-10-25');
    const siguiente = rangoPeriodo('2026-10-28', 'CICLO_26_25');
    assert.equal(siguiente.desde, '2026-10-26');
    assert.equal(siguiente.hasta, '2026-11-25');
    assert.equal(rangoPeriodo('2026-01-10', 'CICLO_26_25').desde, '2025-12-26');
    assert.equal(rangoPeriodo('2026-10-02', 'otra').desde, '2026-10-01');
  });

  it('cuentan planificados y realizados de esa empresa; no el cancelado, el rechazado, el vencido, el cupo ni el no presentado', () => {
    const turnos = [
      ev('2026-10-02', 8),
      ev('2026-10-03', 8, { draft: true }),
      ev('2026-10-04', 8, { isCompleted: true, isPresent: true }),
      ev('2026-10-05', 8, { isAbsent: true }),
      ev('2026-10-06', 8, { pagaJornada: false }),
      ev('2026-10-07', 8, { noSePresento: true }),
      ev('2026-10-08', 8, { status: 'cupo_completo' }),
      ev('2026-10-09', 8, { status: 'rechazada' }),
      ev('2026-10-10', 8, { status: 'vencida' }),
      ev('2026-10-11', 8, { status: 'cancelada' }),
      ev('2026-10-12', 8, { isUnassigned: true }),
      ev('2026-10-13', 8, { empresaId: 'otra' }),
      { ...ev('2026-10-14', 8), esEventual: false, code: 'M' },
      ev('2026-09-30', 8),
    ];
    assert.equal(horasComprometidas({ turnos, empresaId: emp, desde: '2026-10-01', hasta: '2026-10-31' }), 24);
    assert.equal(turnoCuentaParaTope(ev('2026-10-02', 8, { code: 'EV', esEventual: false }), emp), true);
    assert.equal(normalizarTope(undefined, TOPE_HORAS_DEFAULT), 50);
    assert.equal(normalizarTope(0, 50), 50);
  });

  it('bloquea al pasar el tope con el texto del turno, y 50 justo entra', () => {
    const turnos = [ev('2026-10-02', 40), ev('2026-10-03', 8)];
    const justo = evaluarJornadasContraTope({
      turnos, empresaId: emp, periodo: 'CALENDARIO', tope: 50, margen: 0,
      jornadas: [{ fecha: '2026-10-20', horas: 2, horaInicio: '08:00' }],
    });
    assert.equal(justo.supera, false);
    assert.equal(justo.oculto, false);
    assert.equal(justo.usadas, 48);
    const pasa = evaluarJornadasContraTope({
      turnos, empresaId: emp, periodo: 'CALENDARIO', tope: 50,
      jornadas: [{ fecha: '2026-10-20', horas: 8, horaInicio: '18:00' }],
    });
    assert.equal(pasa.supera, true);
    assert.equal(pasa.motivo, 'Supera el tope mensual (48/50 h, este turno 8 h)');
    assert.equal(motivoTopeHoras(48, 50, 8), pasa.motivo);
    assert.equal(evaluarTope({ usadas: 42, tope: 50, horasTurno: 8 }).supera, false);
    assert.equal(evaluarTope({ usadas: 43, tope: 50, horasTurno: 8 }).supera, true);
  });

  it('margen: con tope 50 y margen 2 no se ofrece a quien ya tiene 48 h o más, aunque el turno entre', () => {
    assert.equal(TOPE_MARGEN_DEFAULT, 2);
    assert.equal(normalizarMargen(undefined), 2);
    assert.equal(normalizarMargen(-1), 2);
    assert.equal(normalizarMargen(0), 0);
    assert.equal(normalizarMargen(500, 2, 50), 50);
    assert.equal(topeEfectivo({ eventualesTopeHoras: 50 }, null).margen, 2);
    assert.equal(topeEfectivo({ eventualesTopeHoras: 50, eventualesTopeMargen: 5 }, null).margen, 5);
    const cerca = evaluarTope({ usadas: 48, tope: 50, horasTurno: 1, margen: 2 });
    assert.equal(cerca.supera, false);
    assert.equal(cerca.cerca, true);
    assert.equal(cerca.oculto, true);
    assert.equal(cerca.aviso, false);
    assert.equal(cerca.motivo, 'Cerca del tope mensual (48/50 h, margen 2 h)');
    assert.equal(motivoCercaTope(48, 50, 2), cerca.motivo);
    const libre = evaluarTope({ usadas: 47, tope: 50, horasTurno: 1, margen: 2 });
    assert.equal(libre.oculto, false);
    assert.equal(libre.aviso, true);
    const sinMargen = evaluarTope({ usadas: 49, tope: 50, horasTurno: 1, margen: 0 });
    assert.equal(sinMargen.oculto, false);
    const alcanzado = evaluarTope({ usadas: 50, tope: 50, horasTurno: 1, margen: 0 });
    assert.equal(alcanzado.alcanzado, true);
    assert.equal(alcanzado.supera, true);
    assert.equal(chipTope({ usadas: 50, tope: 50, margen: 2 }), 'Tope alcanzado');
    assert.equal(chipTope({ usadas: 48, tope: 50, margen: 2 }), 'Cerca del tope');
    assert.equal(chipTope({ usadas: 47, tope: 50, margen: 2 }), null);
    assert.equal(textoOcultosPorTope(1), '1 eventual oculto por tope de horas');
    assert.equal(textoOcultosPorTope(3), '3 eventuales ocultos por tope de horas');
    const porJornadas = evaluarJornadasContraTope({
      turnos: [ev('2026-10-02', 48)], empresaId: emp, periodo: 'CALENDARIO', tope: 50, margen: 2,
      jornadas: [{ fecha: '2026-10-20', horas: 1, horaInicio: '08:00' }],
    });
    assert.equal(porJornadas.oculto, true);
    assert.equal(porJornadas.motivo, 'Cerca del tope mensual (48/50 h, margen 2 h)');
  });

  it('el ciclo 26→25 no mezcla el mes calendario', () => {
    const turnos = [ev('2026-10-02', 40), ev('2026-09-20', 20), ev('2026-10-28', 20)];
    const enCiclo = evaluarJornadasContraTope({
      turnos, empresaId: emp, periodo: 'CICLO_26_25', tope: 50,
      jornadas: [{ fecha: '2026-10-10', horas: 8, horaInicio: '08:00' }],
    });
    assert.equal(enCiclo.usadas, 40);
    assert.equal(enCiclo.supera, false);
    const octubre = evaluarJornadasContraTope({
      turnos, empresaId: emp, periodo: 'CALENDARIO', tope: 50,
      jornadas: [{ fecha: '2026-10-10', horas: 8, horaInicio: '08:00' }],
    });
    assert.equal(octubre.usadas, 60);
    assert.equal(octubre.supera, true);
  });

  it('la excepción por eventual (con motivo) pisa el tope de la empresa; sin motivo no', () => {
    assert.equal(topeEfectivo({ eventualesTopeHoras: 50 }, null).tope, 50);
    assert.equal(topeEfectivo({}, { horas: 80, motivo: 'Evento de fin de año' }).tope, 80);
    assert.equal(topeEfectivo({}, { horas: 80, motivo: 'Evento de fin de año' }).excepcion, true);
    assert.equal(topeEfectivo({ eventualesTopeHoras: 50 }, { horas: 80, motivo: '   ' }).tope, 50);
    assert.equal(topeEfectivo({ eventualesPeriodoHoras: 'CICLO_26_25' }, null).periodo, 'CICLO_26_25');
  });

  it('aviso ámbar desde el 80%, no antes', () => {
    assert.equal(evaluarTope({ usadas: 40, tope: 50, horasTurno: 0 }).aviso, true);
    assert.equal(evaluarTope({ usadas: 40, tope: 50, horasTurno: 0 }).texto, '40/50 h este mes');
    assert.equal(evaluarTope({ usadas: 39, tope: 50, horasTurno: 8 }).aviso, false);
    assert.equal(evaluarTope({ usadas: 48, tope: 50, horasTurno: 8 }).aviso, false);
    const reserva = horasComprometidas({
      turnos: [ev('2026-10-02', 40)],
      reservas: [{ empresaId: emp, fecha: '2026-10-03', horaInicio: '15:00', horas: 8, venceAtMs: 9_999 }],
      empresaId: emp, desde: '2026-10-01', hasta: '2026-10-31', ahoraMs: 1,
    });
    assert.equal(reserva, 48);
  });
});
