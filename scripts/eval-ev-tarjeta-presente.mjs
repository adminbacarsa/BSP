/**
 * Tarjeta del CC: con presencia nunca se muestra DESCUBIERTO; el alta ARCA es un aviso legible.
 *   node --experimental-strip-types scripts/eval-ev-tarjeta-presente.mjs
 */
import { ALTA_ARCA_AVISO_TEXTO, altaArcaPendienteVisible, mostrarDescubierto } from '../apps/web2/src/lib/operaciones/guardCardEstado.ts';

let fallas = 0;
function check(name, ok, detail = '') {
  if (!ok) fallas += 1;
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const start = new Date('2026-10-02T12:00:00-03:00');
check('AA escalado sin presencia → DESCUBIERTO', mostrarDescubierto({ isSinCobertura: true, isPresent: false }) === true);
check('revertido (ingresó) con marca vieja → activo, no DESCUBIERTO', mostrarDescubierto({ isSinCobertura: true, isPresent: true }) === false);
check('vacante descubierta → DESCUBIERTO', mostrarDescubierto({ isDescubierto: true }) === true);
check('sin marcas → nada', mostrarDescubierto({}) === false);
check('alta ARCA desde T−2 h', altaArcaPendienteVisible({ esEventual: true, shiftDateObj: start }, new Date('2026-10-02T10:30:00-03:00')) === true);
check('alta ARCA antes de T−2 h no se muestra', altaArcaPendienteVisible({ esEventual: true, shiftDateObj: start }, new Date('2026-10-02T09:00:00-03:00')) === false);
check('alta confirmada no avisa', altaArcaPendienteVisible({ esEventual: true, eventualAltaArcaConfirmada: true, shiftDateObj: start }, new Date('2026-10-02T12:41:00-03:00')) === false);
check('texto legible, sin snake_case', ALTA_ARCA_AVISO_TEXTO === 'Alta ARCA pendiente · urgente' && !/_/.test(ALTA_ARCA_AVISO_TEXTO));

console.log(fallas ? `FALLARON ${fallas}` : 'OK 8/8');
process.exit(fallas ? 1 : 0);
