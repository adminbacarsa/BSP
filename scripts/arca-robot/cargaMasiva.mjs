/**
 * Reglas puras del recorrido de Carga Masiva (capturas 05/10: 205-212, 220-223).
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
 * LISTADO DE NOVEDADES. Estado Enviado tras presentar (captura 222).
 * Fecha presentación puede ser `5/10/2026 16:03:45`.
 * @param {string} texto
 * @returns {FilaNovedad[]}
 */
export function parseFilasListado(texto) {
  const src = String(texto || '');
  const filas = [];
  const re = /(\d{4,})\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}:\d{2})?))?(?:\s+(\d{6,}))?\s+(Abierto|Presentado|Cerrado|Anulado|Confirmado|Enviado)/gi;
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

/** Código en CargaMasiva_principal: "Código: 245746". */
export function extraerCodigoPrincipal(texto) {
  const m = String(texto || '').match(/C[oó]digo\s*:\s*(\d{4,})/i);
  return m ? m[1] : '';
}

/**
 * Tras Cargar (upload): Informado SI · Estado Válido | Inválido · Registros N.
 * @returns {{ informado: string, estado: string, registros: number, ok: boolean, mensaje: string }}
 */
export function leerEstadoCarga(texto) {
  const src = String(texto || '');
  const informadoRaw = (src.match(/Informado\s*[:\s]?\s*(S[IÍ]|NO|SI)/i) || [])[1]
    || (src.match(/\b(SI|S[IÍ]|NO)\s+(V[aá]lido|Inv[aá]lido|Pendiente)/i) || [])[1]
    || '';
  const estadoRaw = (src.match(/\b(V[aá]lido|Inv[aá]lido|Pendiente|Procesado|Error|OK|Con\s+errores)\b/i) || [])[1] || '';
  const regM = src.match(/Registros?\s*[:\s]?\s*(\d+)/i);
  const registros = regM ? Number(regM[1]) : -1;
  const informado = String(informadoRaw || '').toUpperCase().replace('Í', 'I');
  const estado = String(estadoRaw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const mensajeOk = /Archivo cargado correctamente/i.test(src);
  const ok = informado === 'SI' && /^Valido$/i.test(estado) && mensajeOk;
  return {
    informado,
    estado: estadoRaw || estado,
    registros: Number.isFinite(registros) ? registros : -1,
    ok,
    mensaje: mensajeOk ? 'Archivo cargado correctamente' : '',
  };
}

/** Líneas de error del recuadro: "Línea N: …". */
export function extraerErroresLinea(texto) {
  const src = String(texto || '');
  const found = [];
  // ARCA sirve «Línea» mal codificado (LÃ�nea): se acepta cualquier cosa entre la L y «nea».
  const re = /L\S{1,4}nea\s+\d+\s*:[^\n\r]+/gi;
  let m = re.exec(src);
  while (m) {
    found.push(m[0].trim().replace(/^L\S{1,4}nea/i, 'Línea'));
    m = re.exec(src);
  }
  return found;
}

/** Líneas no vacías del TXT (cada alta/baja = 1 registro). */
export function contarLineasTxt(contenido) {
  return String(contenido || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
}

export function validarCargaOk({ estadoCarga, lineasTxt }) {
  if (!estadoCarga || !estadoCarga.ok) {
    const errs = [];
    if (estadoCarga?.informado && estadoCarga.informado !== 'SI') errs.push(`INFORMADO_${estadoCarga.informado}`);
    if (estadoCarga?.estado && !/^v[aá]lido$/i.test(estadoCarga.estado)) errs.push(`ESTADO_${estadoCarga.estado}`);
    return { ok: false, error: errs.join('|') || 'CARGA_INVALIDA' };
  }
  const r = Number(estadoCarga.registros);
  const n = Number(lineasTxt);
  if (!Number.isFinite(r) || r < 0) return { ok: false, error: 'SIN_REGISTROS_ARCA' };
  if (r !== n) return { ok: false, error: `REGISTROS_DISTINTOS:${r}!=${n}` };
  return { ok: true };
}

/** Tras Enviar: nro de la fila del código guardado (Estado Enviado). */
export function nroDesdeFilaListado(filas, codigo) {
  const c = String(codigo || '').trim();
  const fila = (filas || []).find((f) => String(f.codigo) === c);
  return fila && fila.nroTransaccion ? String(fila.nroTransaccion) : '';
}

export function urlConstanciaSeti(nroTransaccion) {
  const nro = String(nroTransaccion || '').replace(/\D/g, '');
  if (!nro) return '';
  return `https://seti.afip.gob.ar/setiweb/#/presentacion/ticket?nroTransaccion=${nro}`;
}

/** Acuse SETI (captura 223): Nro. verificador + Código de Control. */
export function extraerDatosConstancia(texto) {
  const src = String(texto || '');
  const nroVerificador = (src.match(/Nro\.?\s*verificador\s*[:\s]+(\d+)/i) || [])[1] || '';
  const codigoControl = (src.match(/C[oó]digo de Control\s*[:\s]+([A-Za-z0-9]+)/i) || [])[1] || '';
  return { nroVerificador, codigoControl };
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
  cargaMasivaUpload:
    'https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/Contribuyente/RelacionLaboral/CargaMasiva_upload.aspx?reg=01',
};
