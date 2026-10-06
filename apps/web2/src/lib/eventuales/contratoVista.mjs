/**
 * Solapa Contratos de la ficha del eventual: anexo (firmado / pendiente / no exigido), escala y bruto,
 * ARCA del contrato y nombres de los PDF. Solo textos; sin Firestore ni Node.
 */
import { fmtFechaAr } from './fichaUx.mjs';

export const TEXTO_SIN_FIRMAR = 'SIN FIRMAR';

const ARCA_TIPO = {
  AT: 'Alta (AT)',
  BT: 'Baja (BT)',
  MR: 'Modificación (MR)',
  ANULACION: 'Anulación del alta',
  BAJA_NO_PRESENTACION: 'Baja por no presentación',
};

const ARCA_ESTADO = {
  PENDIENTE: 'Pendiente',
  SUBIENDO: 'Subiendo',
  ENVIADO: 'Enviado',
  VERIFICAR: 'A verificar',
  CONFIRMADO: 'Confirmado',
  ANULADO: 'Anulado',
  ERROR: 'Error',
  MANUAL: 'Manual',
  RECHAZADO: 'Rechazado',
};

const CONTRATO_ESTADO = {
  BORRADOR: 'Borrador',
  CONFIRMADO: 'Confirmado',
  DOCUMENTADO: 'Documentado',
  ACUSE_RECIBIDO: 'Acuse recibido',
  ANULADO: 'Anulado',
  FINALIZADO: 'Finalizado',
  SUSTITUIDO: 'Sustituido',
};

export function textoEstadoContrato(estado) {
  return CONTRATO_ESTADO[String(estado || '').toUpperCase()] || (estado ? String(estado) : '—');
}

/** «02/10/2026 → 02/10/2026» o solo la fecha si es un día. */
export function textoPeriodoContrato(c) {
  const desde = fmtFechaAr(c?.fechaAlta);
  const hasta = fmtFechaAr(c?.fechaBaja);
  if (desde && hasta && desde !== hasta) return `${desde} → ${hasta}`;
  return desde || hasta || '—';
}

export function textoJornada(j) {
  const horas = Number(j?.horas) > 0 ? ` (${Number(j.horas)} h)` : '';
  return `${fmtFechaAr(j?.fecha)} · ${j?.horaInicio || '—'}–${j?.horaFin || '—'}${horas}`;
}

function fechaHoraAr(iso) {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t) => (partes.find((p) => p.type === t)?.value || '').padStart(2, '0');
  return `${v('day')}/${v('month')} ${v('hour')}:${v('minute')}`;
}

/**
 * Estado del anexo en palabras. `anexo` es el doc firmado (`anexos_eventuales`) si existe.
 * `reenviar` = corresponde ofrecer «Reenviar código».
 * @param {{ contrato?: any, anexo?: any, exigirMarco?: boolean, ahoraMs?: number }} [p]
 */
export function estadoAnexoVista({ contrato, anexo = null, exigirMarco = true, ahoraMs = Date.now() } = {}) {
  const estadoCtr = String(contrato?.anexoEstado || '').toUpperCase();
  if (anexo?.fechaHora || estadoCtr === 'FIRMADO') {
    const cuando = fechaHoraAr(anexo?.fechaHora || contrato?.anexoFirmadoAt);
    const disp = String(anexo?.dispositivo || '').trim();
    return {
      id: 'FIRMADO',
      tono: 'ok',
      texto: `Firmado${cuando ? ` ${cuando}` : ''}${disp ? ` (${disp})` : ''}`,
      reenviar: false,
      firmado: true,
    };
  }
  if (!exigirMarco || estadoCtr === 'NO_EXIGIDO') {
    return { id: 'NO_EXIGIDO', tono: 'neutro', texto: 'No exigido', reenviar: false, firmado: false };
  }
  if (estadoCtr === 'SIN_EFECTO') {
    return { id: 'SIN_EFECTO', tono: 'neutro', texto: 'Sin efecto', reenviar: false, firmado: false };
  }
  if (['ANULADO', 'FINALIZADO', 'SUSTITUIDO'].includes(String(contrato?.estado || '').toUpperCase())) {
    return { id: 'CERRADO', tono: 'neutro', texto: 'Sin firmar (contrato cerrado)', reenviar: false, firmado: false };
  }
  if (estadoCtr === 'SIN_CANAL') {
    return { id: 'SIN_CANAL', tono: 'malo', texto: 'Pendiente de firma · sin mail ni app para el código', reenviar: true, firmado: false };
  }
  const vence = Number(contrato?.codigoVenceMs || 0);
  const vigente = vence > ahoraMs;
  return {
    id: 'PENDIENTE',
    tono: 'pendiente',
    texto: vigente ? `Pendiente de firma · código vigente hasta ${fechaHoraAr(new Date(vence).toISOString())}` : 'Pendiente de firma',
    reenviar: true,
    firmado: false,
  };
}

/**
 * Línea «Escala aplicada» + bruto. Con el anexo firmado manda lo que quedó en el anexo.
 * @param {{ contrato?: any, anexo?: any }} [p]
 */
export function textoEscalaYBruto({ contrato, anexo = null } = {}) {
  const escala = String(anexo?.escalaTexto || contrato?.anexoEscalaTexto || '').trim();
  const bruto = anexo?.brutoTexto || contrato?.anexoBrutoTexto || '';
  const respaldo = anexo?.escalaRespaldo === true || contrato?.anexoEscalaRespaldo === true;
  return {
    escala: escala || 'Sin escala aprobada: el anexo no informa el bruto.',
    bruto: bruto ? `Bruto ${bruto}` : '',
    aviso: respaldo ? 'Escala de respaldo: no había escala vigente a la fecha del servicio.' : '',
  };
}

/** Envíos ARCA que corresponden a este contrato, con texto listo. */
export function enviosDelContrato(arca, contratoId) {
  const id = String(contratoId || '');
  return (arca || [])
    .filter((e) => (Array.isArray(e?.contratoIds) ? e.contratoIds.map(String).includes(id) : String(e?.contratoId || '') === id))
    .map((e) => textoEnvioArca(e));
}

export function textoEnvioArca(e) {
  const tipo = ARCA_TIPO[String(e?.tipo || '').toUpperCase()] || String(e?.tipo || 'Envío');
  const estadoRaw = String(e?.estado || '').toUpperCase();
  const estado = ARCA_ESTADO[estadoRaw] || (estadoRaw ? estadoRaw[0] + estadoRaw.slice(1).toLowerCase() : '—');
  const nro = String(e?.nroTransaccion || '').trim();
  const partes = [estado];
  if (nro) partes.push(`nº ${nro}`);
  if (e?.quitadoDelLote) partes.push('fuera del lote');
  if (e?.acuseAnulacion) partes.push(`acuse ${e.acuseAnulacion}`);
  const fecha = fmtFechaAr(e?.fechaBaja || e?.fechaAlta);
  const tono = estadoRaw === 'CONFIRMADO' ? 'ok'
    : ['ERROR', 'MANUAL', 'RECHAZADO'].includes(estadoRaw) ? 'malo'
      : estadoRaw === 'ANULADO' ? 'neutro' : 'pendiente';
  return {
    id: String(e?.id || ''),
    tipo,
    estado: partes.join(' · '),
    tono,
    fecha,
    constanciaUrl: String(e?.constanciaUrl || '').trim() || null,
    nroTransaccion: nro || null,
  };
}

/**
 * Dispositivo que queda en la constancia y en la ficha. Si la app lo manda, ese; si no, un resumen
 * corto del user-agent (nunca el user-agent entero).
 */
export function resumirDispositivo(dispositivo, userAgent = '') {
  const propio = String(dispositivo || '').trim();
  if (propio) return propio.slice(0, 60);
  const ua = String(userAgent || '');
  if (!ua) return '';
  if (/okhttp|Expo|ReactNative/i.test(ua) && /Android/i.test(ua)) return 'app Android';
  if (/Expo|ReactNative|CFNetwork|Darwin/i.test(ua) && !/Mozilla/i.test(ua)) return 'app iPhone';
  if (/okhttp|Expo|ReactNative/i.test(ua)) return 'app del celular';
  if (/iPhone|iPad/i.test(ua)) return 'navegador iPhone';
  if (/Android/i.test(ua)) return 'navegador Android';
  if (/Mobile/i.test(ua)) return 'navegador celular';
  return 'navegador';
}

export function nombrePdfAnexo({ empresa, fecha, firmado }) {
  const emp = String(empresa || 'Empresa').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const dia = String(fecha || '').slice(0, 10) || 'sin-fecha';
  return `Anexo-${emp}-${dia}${firmado ? '' : '-SIN-FIRMAR'}.pdf`;
}

export function nombrePdfMarco({ empresa, fecha }) {
  const emp = String(empresa || 'Empresa').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const dia = String(fecha || '').slice(0, 10) || 'sin-fecha';
  return `Marco-${emp}-${dia}.pdf`;
}
