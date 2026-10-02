import test from 'node:test';
import assert from 'node:assert/strict';
import {
  camposTurnoDesdeSwitches, ETIQUETA_PRUEBAS_SIN_ARCA, ETIQUETA_PRUEBAS_SIN_MARCO, etiquetasPruebas, exigeAltaArca, exigeMarco, planSwitchesPruebas,
} from './pruebasSwitch.mjs';
import { isAltaArcaConfirmada } from './arcaEnvios.mjs';

// Los casos del switch sobre la candidatura (motor único `eventualesParaHueco`) están en candidatosUnificados.test.mjs.
test('default: ausente = se exige marco y alta ARCA', () => {
  assert.equal(exigeMarco({}), true);
  assert.equal(exigeAltaArca({}), true);
  assert.equal(exigeMarco({ exigirMarco: false }), false);
  assert.deepEqual(etiquetasPruebas({}), []);
  assert.deepEqual(etiquetasPruebas({ exigirMarco: false, exigirAltaArca: false }), [ETIQUETA_PRUEBAS_SIN_MARCO, ETIQUETA_PRUEBAS_SIN_ARCA]);
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
