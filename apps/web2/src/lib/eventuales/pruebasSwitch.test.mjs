import test from 'node:test';
import assert from 'node:assert/strict';
import {
  camposTurnoDesdeSwitches, ETIQUETA_PRUEBAS_SIN_ARCA, ETIQUETA_PRUEBAS_SIN_MARCO, etiquetasPruebas, exigeAltaArca, exigeMarco, planSwitchesPruebas,
} from './pruebasSwitch.mjs';
import { evaluarCandidato } from './planificacion.mjs';
import { isAltaArcaConfirmada } from './arcaEnvios.mjs';

const hoy = '2026-10-02';
const jornadas = [{ fecha: '2026-10-05', horaInicio: '08:00', horaFin: '16:00', horas: 8 }];
const base = {
  cuil: '20111111119', nombre: 'Perez, Ana', disponibilidad: 'DISPONIBLE',
  credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
};

test('default: ausente = se exige marco y alta ARCA', () => {
  assert.equal(exigeMarco({}), true);
  assert.equal(exigeAltaArca({}), true);
  assert.equal(exigeMarco({ exigirMarco: false }), false);
  assert.deepEqual(etiquetasPruebas({}), []);
  assert.deepEqual(etiquetasPruebas({ exigirMarco: false, exigirAltaArca: false }), [ETIQUETA_PRUEBAS_SIN_MARCO, ETIQUETA_PRUEBAS_SIN_ARCA]);
});

test('evaluarCandidato: sin marco ni empresa habilitada bloquea con switch ON', () => {
  const r = evaluarCandidato({ bolsa: { ...base, empresasHabilitadas: [] }, empresaId: 'ev_emp', jornadas, otrasJornadas: [], hoy });
  assert.equal(r.elegible, false);
  assert.equal(r.motivoCodigo, 'EMPRESA_NO_HABILITADA');
  const sinMarco = evaluarCandidato({ bolsa: { ...base, empresasHabilitadas: ['ev_emp'], marcos: {} }, empresaId: 'ev_emp', jornadas, otrasJornadas: [], hoy });
  assert.equal(sinMarco.elegible, false);
  assert.equal(sinMarco.motivoCodigo, 'SIN_MARCO');
  assert.equal(sinMarco.pruebasSinMarco, false);
});

test('evaluarCandidato: switch OFF → elegible sin marco ni empresa, marcado «Pruebas: sin exigir marco»', () => {
  const r = evaluarCandidato({ bolsa: { ...base, empresasHabilitadas: [], marcos: {}, exigirMarco: false }, empresaId: 'ev_emp', jornadas, otrasJornadas: [], hoy });
  assert.equal(r.elegible, true);
  assert.equal(r.pruebasSinMarco, true);
  assert.ok(r.alertas.includes(ETIQUETA_PRUEBAS_SIN_MARCO));
});

test('evaluarCandidato: switch OFF sigue exigiendo credencial, apto y descanso 12 h', () => {
  const vencida = evaluarCandidato({ bolsa: { ...base, credencialVencimiento: '2026-01-01', exigirMarco: false }, empresaId: 'ev_emp', jornadas, otrasJornadas: [], hoy });
  assert.equal(vencida.elegible, false);
  assert.equal(vencida.motivoCodigo, 'CREDENCIAL_VENCIDA');
  const cruce = evaluarCandidato({
    bolsa: { ...base, exigirMarco: false }, empresaId: 'ev_emp', jornadas,
    otrasJornadas: [{ fecha: '2026-10-05', horaInicio: '00:00', horaFin: '07:00', horas: 7, empresaId: 'otra' }], hoy,
  });
  assert.equal(cruce.elegible, false);
});

test('gate de fichada: exigirAltaArca OFF en el turno deja fichar sin alta confirmada', () => {
  assert.equal(isAltaArcaConfirmada({ esEventual: true, eventualAltaArcaConfirmada: false }), false);
  assert.equal(isAltaArcaConfirmada({ esEventual: true, eventualAltaArcaConfirmada: false, eventualExigirAltaArca: false }), true);
  assert.equal(isAltaArcaConfirmada({ esEventual: true, eventualAltaArcaConfirmada: true }), true);
  assert.equal(isAltaArcaConfirmada({ esEventual: false }), true);
  assert.deepEqual(camposTurnoDesdeSwitches({}), { eventualExigirAltaArca: true });
  assert.deepEqual(camposTurnoDesdeSwitches({ exigirAltaArca: false }), { eventualExigirAltaArca: false });
});

test('planSwitchesPruebas: solo booleanos, solo los dos campos, sin cambios no escribe', () => {
  assert.equal(planSwitchesPruebas({ exigirMarco: 'no' }, {}).ok, false);
  assert.equal(planSwitchesPruebas({ exigirMarco: null }, {}).ok, false);
  assert.deepEqual(planSwitchesPruebas({ exigirMarco: false, exigirAltaArca: undefined }, {}).patch, { exigirMarco: false });
  const sin = planSwitchesPruebas({ exigirMarco: true }, {});
  assert.deepEqual(sin.cambios, []);
  assert.deepEqual(sin.patch, {});
  const off = planSwitchesPruebas({ exigirMarco: false, exigirAltaArca: false, otro: true }, {});
  assert.deepEqual(off.patch, { exigirMarco: false, exigirAltaArca: false });
  assert.deepEqual(off.patchTurnos, { eventualExigirAltaArca: false });
  assert.equal(off.cambios.length, 2);
  const vuelve = planSwitchesPruebas({ exigirAltaArca: true }, { exigirAltaArca: false });
  assert.deepEqual(vuelve.patch, { exigirAltaArca: true });
  assert.deepEqual(vuelve.patchTurnos, { eventualExigirAltaArca: true });
  const soloMarco = planSwitchesPruebas({ exigirMarco: false }, {});
  assert.deepEqual(soloMarco.patchTurnos, {});
});
