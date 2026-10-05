/**
 * Verificación post-envío y selección de tarjeta para anulación (capturas 224-226).
 * ENVIADO ≠ CONFIRMADO: solo se confirma si aparece la relación eventual (mod 012).
 */

export const VENTANA_VERIFICACION_MS = 48 * 60 * 60 * 1000;
export const MODALIDAD_EVENTUAL = '012';

export const AVISO_RELACION_ACTIVA_EMPLEADOR =
  'ya tiene relación activa con este empleador; ARCA puede rechazar el alta eventual';

/** Normaliza fecha ARCA (DD/MM/YYYY o YYYY-MM-DD o YYYY/MM/DD) → YYYY-MM-DD. */
export function fechaIsoDeArca(valor) {
  const s = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function modalidadCodigo(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(3, '0').slice(-3);
}

/**
 * @typedef {{ fechaInicio?: string, modalidad?: string, cuil?: string, sitRevista?: string, anularDisponible?: boolean }} TarjetaRelacion
 */

/**
 * Verifica si la consulta por CUIL ya muestra el alta eventual enviada.
 * @returns {{ accion: 'CONFIRMADO'|'VERIFICAR'|'REINTENTAR'|'MANUAL', motivo?: string, tarjeta?: TarjetaRelacion }}
 */
export function decidirResultadoVerificacion({
  tarjetas,
  fechaAlta,
  ahoraMs,
  enviadaAtMs,
  ventanaMs = VENTANA_VERIFICACION_MS,
  modalidad = MODALIDAD_EVENTUAL,
}) {
  const fecha = fechaIsoDeArca(fechaAlta);
  const mod = modalidadCodigo(modalidad);
  const matches = (tarjetas || []).filter((t) => {
    return fechaIsoDeArca(t.fechaInicio) === fecha && modalidadCodigo(t.modalidad) === mod;
  });
  if (matches.length === 1) return { accion: 'CONFIRMADO', tarjeta: matches[0] };
  if (matches.length > 1) return { accion: 'MANUAL', motivo: 'VARIAS_TARJETAS_012' };
  const enviada = Number(enviadaAtMs) || 0;
  const ahora = Number(ahoraMs) || 0;
  if (enviada > 0 && ahora - enviada >= ventanaMs) {
    return { accion: 'VERIFICAR', motivo: 'SIN_TARJETA_EN_48H' };
  }
  return { accion: 'REINTENTAR', motivo: 'AUN_NO_APARECE' };
}

/**
 * Anulación: una sola tarjeta con Fecha de Inicio + modalidad 012. Nunca la primera del CUIL.
 * @returns {{ accion: 'ANULAR'|'MANUAL', motivo?: string, tarjeta?: TarjetaRelacion }}
 */
export function decidirTarjetaAnulacion({ tarjetas, fechaInicio, modalidad = MODALIDAD_EVENTUAL }) {
  const fecha = fechaIsoDeArca(fechaInicio);
  const mod = modalidadCodigo(modalidad);
  if (!fecha || !mod) return { accion: 'MANUAL', motivo: 'SIN_DATOS_BUSQUEDA' };
  const matches = (tarjetas || []).filter((t) => {
    return fechaIsoDeArca(t.fechaInicio) === fecha && modalidadCodigo(t.modalidad) === mod;
  });
  if (matches.length === 1) {
    const t = matches[0];
    if (t.anularDisponible === false) {
      return { accion: 'MANUAL', motivo: 'ANULAR_NO_DISPONIBLE', tarjeta: t };
    }
    return { accion: 'ANULAR', tarjeta: t };
  }
  if (matches.length === 0) return { accion: 'MANUAL', motivo: 'SIN_TARJETA_012' };
  return { accion: 'MANUAL', motivo: 'VARIAS_TARJETAS_012' };
}

/**
 * Parsea tarjetas de Consultas / Modificaciones y Bajas desde texto de página.
 * Busca bloques con Fecha de Inicio y Mod. Contrato.
 * @returns {TarjetaRelacion[]}
 */
export function parseTarjetasRelacion(texto) {
  const src = String(texto || '');
  const out = [];
  const reMod = /Mod\.?\s*Contrato\s*[:\s]+(\d{1,3})/gi;
  const reFecha = /Fecha de Inicio\s*[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/gi;
  const mods = [...src.matchAll(reMod)].map((m) => m[1]);
  const fechas = [...src.matchAll(reFecha)].map((m) => m[1]);
  const n = Math.min(mods.length, fechas.length);
  for (let i = 0; i < n; i += 1) {
    out.push({ fechaInicio: fechas[i], modalidad: mods[i] });
  }
  return out;
}

/**
 * Advertencia si el CUIL ya es empleado ACTIVO (no eventual) de una empresa con el mismo CUIT empleador.
 * @returns {string|null} código de advertencia o null
 */
export function advertenciaRelacionActivaEmpleador({
  cuil,
  empresaId,
  empresaCuit,
  empleados = [],
  empresas = [],
}) {
  const cuilDig = String(cuil || '').replace(/\D/g, '');
  const cuitEmp = String(empresaCuit || '').replace(/\D/g, '');
  if (!cuilDig || cuilDig.length !== 11 || !cuitEmp) return null;
  const cuitPorEmpresa = new Map();
  for (const e of empresas) {
    const id = String(e.id || e.empresaId || '');
    const cuit = String(e.cuit || e.arcaRobotAcceso?.cuitRepresentado || '').replace(/\D/g, '');
    if (id && cuit) cuitPorEmpresa.set(id, cuit);
  }
  if (empresaId && cuitEmp) cuitPorEmpresa.set(String(empresaId), cuitEmp);
  for (const emp of empleados) {
    const status = String(emp.status || emp.estado || '').toUpperCase();
    if (status && status !== 'ACTIVE' && status !== 'ACTIVO') continue;
    if (emp.esEventual === true || emp.eventual === true) continue;
    const empCuil = String(emp.cuil || emp.cuit || '').replace(/\D/g, '');
    if (empCuil !== cuilDig) continue;
    const empEmpresa = String(emp.empresaId || '');
    const cuitLegajo = cuitPorEmpresa.get(empEmpresa) || '';
    if (cuitLegajo && cuitLegajo === cuitEmp) return 'RELACION_ACTIVA_EMPLEADOR';
  }
  return null;
}

/** Estados que habilitan fichada (tienen nro) aunque la verificación ARCA siga pendiente. */
export function estadoHabilitaFichada(estado) {
  return ['ENVIADO', 'VERIFICAR', 'CONFIRMADO'].includes(String(estado || ''));
}
