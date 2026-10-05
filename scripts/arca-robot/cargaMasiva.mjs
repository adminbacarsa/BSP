/**
 * Reglas puras del recorrido de Carga Masiva (capturas 05/10).
 * No abre ARCA ni toca credenciales.
 */

/** @typedef {{ codigo: string, fechaCreacion?: string, fechaPresentacion?: string, nroTransaccion?: string, estado: string }} FilaNovedad */

/**
 * Si no hay abierta → Nuevo. Si la abierta es la del lote COSP → editar.
 * Si hay otra abierta ajena → error (nunca borrar).
 * @param {{ filas: FilaNovedad[], codigoLote?: string }} input
 */
export function decidirNovedadAbierta({ filas, codigoLote }) {
  const abiertas = (filas || []).filter((f) => /^abierto$/i.test(String(f.estado || '').trim()));
  if (!abiertas.length) return { accion: 'NUEVO' };
  const codigo = String(codigoLote || '').trim();
  const mia = codigo ? abiertas.find((f) => String(f.codigo) === codigo) : null;
  if (mia) return { accion: 'EDITAR', codigo: String(mia.codigo) };
  const ajena = abiertas[0];
  return {
    accion: 'ERROR',
    codigo: String(ajena.codigo),
    mensaje: mensajeNovedadAjena(ajena.codigo),
  };
}

export function mensajeNovedadAjena(codigo) {
  return `Hay una carga masiva abierta en ARCA (código ${codigo}): cerrala o borrala a mano`;
}

/**
 * Parsea filas del LISTADO DE NOVEDADES desde texto de página / tabla.
 * Columnas: Código, Fecha Creación, Fecha Presentación, Nro. Transacción, Estado.
 * @param {string} texto
 * @returns {FilaNovedad[]}
 */
export function parseFilasListado(texto) {
  const src = String(texto || '');
  const filas = [];
  const re = /(\d{4,})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}\/\d{2}\/\d{4}))?(?:\s+(\d{4,}))?\s+(Abierto|Presentado|Cerrado|Anulado|Confirmado)/gi;
  let m = re.exec(src);
  while (m) {
    filas.push({
      codigo: m[1],
      fechaCreacion: m[2],
      fechaPresentacion: m[3] || '',
      nroTransaccion: m[4] || '',
      estado: m[5],
    });
    m = re.exec(src);
  }
  return filas;
}

/** Código en CargaMasiva_principal: "Código: 245548". */
export function extraerCodigoPrincipal(texto) {
  const m = String(texto || '').match(/C[oó]digo\s*:\s*(\d{4,})/i);
  return m ? m[1] : '';
}

/**
 * Tabla Informado / Estado / Registros tras Cargar.
 * @returns {{ informado: string, estado: string, registros: number }}
 */
export function leerEstadoCarga(texto) {
  const src = String(texto || '');
  const informado = (src.match(/Informado\s*[:\s]\s*(S[IÍ]|NO|SI)/i) || [])[1]
    || (src.match(/\b(NO|S[IÍ])\s+(Pendiente|Procesado|Error|OK)/i) || [])[1]
    || '';
  const estado = (src.match(/\b(Pendiente|Procesado|Error|OK|Con\s+errores)\b/i) || [])[1] || '';
  const regM = src.match(/Registros?\s*[:\s]\s*(\d+)/i) || src.match(/\b(\d+)\s*(?=\s*(?:Cargar|Volver|$))/i);
  const registros = regM ? Number(regM[1]) : NaN;
  return {
    informado: String(informado || '').toUpperCase().replace('Í', 'I'),
    estado: String(estado || ''),
    registros: Number.isFinite(registros) ? registros : -1,
  };
}

/** Líneas no vacías del TXT (cada alta/baja = 1 registro). */
export function contarLineasTxt(contenido) {
  return String(contenido || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
}

export function validarRegistrosVsTxt({ registros, lineasTxt }) {
  const r = Number(registros);
  const n = Number(lineasTxt);
  if (!Number.isFinite(r) || r < 0) return { ok: false, error: 'SIN_REGISTROS_ARCA' };
  if (r !== n) return { ok: false, error: `REGISTROS_DISTINTOS:${r}!=${n}` };
  return { ok: true };
}

/** Tras presentar: nro de la fila del código guardado. */
export function nroDesdeFilaListado(filas, codigo) {
  const c = String(codigo || '').trim();
  const fila = (filas || []).find((f) => String(f.codigo) === c);
  return fila && fila.nroTransaccion ? String(fila.nroTransaccion) : '';
}

export const URLS_CARGA = {
  portal: 'https://portalcf.cloud.afip.gob.ar/portal/app/',
  indexContribuyente:
    'https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/login/IndexContribuyente.aspx',
  datosBasicos:
    'https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/Contribuyente/DatosBasicos.aspx',
  cargaMasiva:
    'https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/Contribuyente/RelacionLaboral/CargaMasiva.aspx?reg=01',
  cargaMasivaPrincipal:
    'https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/Contribuyente/RelacionLaboral/CargaMasiva_principal.aspx?reg=01',
};
