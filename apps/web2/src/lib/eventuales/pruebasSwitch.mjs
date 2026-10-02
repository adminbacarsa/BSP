/**
 * Interruptores de pruebas por eventual (ficha `eventuales_bolsa`).
 *
 *  - `exigirMarco` (default ON): con OFF se lo puede convocar y puede aceptar aunque no tenga contrato
 *    marco vigente ni empresa habilitada, y no se bloquea por anexo. Se marca «Pruebas: sin exigir marco».
 *  - `exigirAltaArca` (default ON): con OFF ficha aunque el alta AT no esté confirmada. El turno lleva
 *    `eventualExigirAltaArca` denormalizado (el gate de fichada no lee la bolsa).
 *
 * Los cambia solo SuperAdmin o RRHH con EVENTUALES.update, por `gestionarEventual {accion:'switchesPruebas'}`.
 * Ausente = ON: ninguna ficha vieja cambia de comportamiento.
 */

export const ETIQUETA_PRUEBAS_SIN_MARCO = 'Pruebas: sin exigir marco';
export const ETIQUETA_PRUEBAS_SIN_ARCA = 'Pruebas: sin exigir alta ARCA';

export const SWITCHES_PRUEBAS = [
  { campo: 'exigirMarco', label: 'Exigir contrato marco y habilitación', etiquetaOff: ETIQUETA_PRUEBAS_SIN_MARCO },
  { campo: 'exigirAltaArca', label: 'Exigir alta ARCA para fichar', etiquetaOff: ETIQUETA_PRUEBAS_SIN_ARCA },
];

export function exigeMarco(bolsa) {
  return bolsa?.exigirMarco !== false;
}

export function exigeAltaArca(bolsa) {
  return bolsa?.exigirAltaArca !== false;
}

/** Etiquetas visibles de la ficha / candidato / convocatoria. Vacío = sin pruebas. */
export function etiquetasPruebas(bolsa) {
  const out = [];
  if (!exigeMarco(bolsa)) out.push(ETIQUETA_PRUEBAS_SIN_MARCO);
  if (!exigeAltaArca(bolsa)) out.push(ETIQUETA_PRUEBAS_SIN_ARCA);
  return out;
}

/**
 * Valida el pedido de cambio. Solo acepta los dos campos con booleanos.
 * Devuelve el patch para la bolsa, el patch para los turnos futuros y el texto para `audit_logs`.
 */
export function planSwitchesPruebas(input, actual = {}) {
  const permitidos = SWITCHES_PRUEBAS.map((s) => s.campo);
  const patch = {};
  const cambios = [];
  for (const campo of permitidos) {
    const valor = input?.[campo];
    if (valor === undefined) continue;
    if (typeof valor !== 'boolean') return { ok: false, codigo: 'VALOR_INVALIDO', campo };
    if ((actual?.[campo] !== false) === valor) continue;
    patch[campo] = valor;
    cambios.push(`${campo}: ${valor ? 'ON' : 'OFF (pruebas)'}`);
  }
  if (!cambios.length) return { ok: true, patch: {}, patchTurnos: {}, cambios: [], detalle: 'Sin cambios.' };
  const patchTurnos = 'exigirAltaArca' in patch ? { eventualExigirAltaArca: patch.exigirAltaArca } : {};
  return { ok: true, patch, patchTurnos, cambios, detalle: cambios.join(' · ') };
}

/** Campos que viajan al turno del eventual al crearlo (gate de fichada). */
export function camposTurnoDesdeSwitches(bolsa) {
  return { eventualExigirAltaArca: exigeAltaArca(bolsa) };
}
