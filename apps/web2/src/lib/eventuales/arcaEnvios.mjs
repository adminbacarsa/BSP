/**
 * Envíos de carga masiva ARCA. Un envío = un TXT que alguien tiene que subir.
 * El robot (n8n local) y el link manual escriben el mismo documento.
 * Espejo servidor: apps/functions/src/arca/arcaEnviosCore.ts.
 */
import { lineasCargaMasiva } from './arcaTxt.mjs';

export const ESTADOS_ENVIO = ['PENDIENTE', 'SUBIENDO', 'CONFIRMADO', 'ERROR', 'MANUAL'];
export const TOKEN_VIGENCIA_MS = 48 * 60 * 60 * 1000;
export const ALERTA_ALTA_PENDIENTE_MS = 2 * 60 * 60 * 1000;

const TRANSICIONES = {
  PENDIENTE: ['SUBIENDO', 'MANUAL', 'ERROR', 'CONFIRMADO'],
  SUBIENDO: ['CONFIRMADO', 'ERROR', 'MANUAL'],
  ERROR: ['PENDIENTE', 'SUBIENDO', 'MANUAL', 'CONFIRMADO'],
  MANUAL: ['CONFIRMADO', 'ERROR'],
  CONFIRMADO: [],
};

function txtDeContrato({ contrato, cuil, bruto, obraSocial, empresa }) {
  const out = lineasCargaMasiva({ contrato, cuil, bruto, obraSocial, empresa });
  return { alta: out.lineas[0], baja: out.lineas[1], advertencias: out.advertencias, enviable: out.enviable };
}

function envioBase({ tipo, empresaId, contrato, contratoId, cuil, bruto, obraSocial, empresa, txt, advertencias, enviable }) {
  return {
    empresaId,
    contratoIds: [contratoId],
    bolsaCuil: cuil,
    tipo,
    txt,
    estado: 'PENDIENTE',
    origen: null,
    nroTransaccion: null,
    constanciaUrl: null,
    driveFileId: null,
    advertencias,
    enviable,
    intentos: [],
    token: null,
    fechaAlta: contrato.fechaAlta,
    fechaBaja: contrato.fechaBaja,
  };
}

/** El alta nace al confirmar el contrato (DOCUMENTADO/ACUSE_RECIBIDO → alta ARCA). */
export function planEnvioAlta(input) {
  const { contrato } = input;
  if (!contrato?.fechaAlta) return { ok: false, codigo: 'SIN_FECHA_ALTA' };
  if (!Array.isArray(contrato.jornadas) || contrato.jornadas.length === 0) {
    return { ok: false, codigo: 'SIN_JORNADAS' };
  }
  const { alta, advertencias, enviable } = txtDeContrato(input);
  return {
    ok: true,
    envio: envioBase({ ...input, tipo: 'AT', txt: alta, advertencias, enviable }),
  };
}

/** La baja se genera al cerrar el contrato (FINALIZADO). */
export function planEnvioBaja(input) {
  const { contrato } = input;
  if (!contrato?.fechaBaja) return { ok: false, codigo: 'SIN_FECHA_BAJA' };
  if (!altaConfirmada(input.enviosDelContrato)) return { ok: false, codigo: 'ALTA_NO_CONFIRMADA' };
  const { baja, advertencias, enviable } = txtDeContrato(input);
  return {
    ok: true,
    envio: envioBase({ ...input, tipo: 'BT', txt: baja, advertencias, enviable }),
  };
}

export function transicionEnvio(envio, { estado, origen, nroTransaccion, constanciaUrl, error, actor, at }) {
  const actual = envio?.estado || 'PENDIENTE';
  if (!ESTADOS_ENVIO.includes(estado)) return { ok: false, codigo: 'ESTADO_DESCONOCIDO' };
  if (!(TRANSICIONES[actual] || []).includes(estado)) {
    return { ok: false, codigo: 'TRANSICION_INVALIDA', desde: actual, hacia: estado };
  }
  if (estado === 'CONFIRMADO' && !String(nroTransaccion || '').trim()) {
    return { ok: false, codigo: 'FALTA_NRO_TRANSACCION' };
  }
  const intento = {
    estado,
    origen: origen || envio.origen || 'MANUAL',
    at: at || new Date().toISOString(),
    actor: actor || null,
    error: error || null,
  };
  const patch = {
    estado,
    origen: intento.origen,
    intentos: [...(envio.intentos || []), intento],
  };
  if (estado === 'CONFIRMADO') {
    patch.nroTransaccion = String(nroTransaccion).trim();
    patch.constanciaUrl = constanciaUrl || envio.constanciaUrl || null;
    patch.token = null;
  }
  if (estado === 'ERROR') patch.ultimoError = error || 'SIN_DETALLE';
  return { ok: true, patch };
}

/** Token de un solo uso. `random` inyectable para test. */
export function nuevoToken(nowMs, random = () => Math.random()) {
  let token = '';
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 32; i += 1) token += abc[Math.floor(random() * abc.length)];
  return { token, tokenExpiraAt: new Date(nowMs + TOKEN_VIGENCIA_MS).toISOString(), tokenUsadoAt: null };
}

export function validarToken(envio, token, nowMs) {
  if (!envio) return { ok: false, codigo: 'NO_EXISTE' };
  if (!envio.token || !token || envio.token !== token) return { ok: false, codigo: 'TOKEN_INVALIDO' };
  if (envio.tokenUsadoAt) return { ok: false, codigo: 'TOKEN_USADO' };
  if (envio.estado === 'CONFIRMADO') return { ok: false, codigo: 'YA_CONFIRMADO' };
  const vence = Date.parse(envio.tokenExpiraAt || '');
  if (!Number.isFinite(vence) || nowMs > vence) return { ok: false, codigo: 'TOKEN_VENCIDO' };
  return { ok: true };
}

/** Lo que ve la página pública: sin CUIL, sin nombre, sin importes. */
export function vistaPublicaEnvio(envio) {
  return {
    empresaNombre: envio.empresaNombre || '',
    tipo: envio.tipo,
    cantidadRegistros: String(envio.txt || '').split('\n').filter((l) => l.trim()).length,
    fechaAlta: envio.fechaAlta || null,
    fechaBaja: envio.tipo === 'BT' ? envio.fechaBaja || null : null,
    estado: envio.estado,
    advertencias: envio.advertencias || [],
  };
}

export function altaConfirmada(envios) {
  return (envios || []).some((e) => e.tipo === 'AT' && e.estado === 'CONFIRMADO');
}

/** Gate de fichada. El turno del eventual lleva el estado denormalizado del alta. */
export function isAltaArcaConfirmada(shift) {
  if (!shift || shift.esEventual !== true) return true;
  return shift.eventualAltaArcaConfirmada === true;
}

/** Desde T−2 h el CC ve la alerta. Antes no molesta. */
export function alertaAltaArcaPendiente(shift, nowMs) {
  if (isAltaArcaConfirmada(shift)) return null;
  const start = Number(shift?.startTimeMs);
  if (!Number.isFinite(start)) return null;
  if (nowMs < start - ALERTA_ALTA_PENDIENTE_MS) return null;
  return {
    tipo: 'ALTA_ARCA_PENDIENTE',
    prioridad: 'ALTA',
    contratoId: shift.eventualContratoId || null,
    minutosAlInicio: Math.round((start - nowMs) / 60000),
  };
}
