/**
 * Espejo servidor de apps/web2/src/lib/eventuales/arcaEnvios.mjs.
 * Si cambia una regla de estado o de token, cambiar las dos copias.
 */
import { randomBytes } from 'crypto';

export const ESTADOS_ENVIO = ['PENDIENTE', 'SUBIENDO', 'CONFIRMADO', 'ERROR', 'MANUAL'] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];
export type OrigenEnvio = 'ROBOT' | 'MANUAL' | 'LINK';

export const TOKEN_VIGENCIA_MS = 48 * 60 * 60 * 1000;
export const ALERTA_ALTA_PENDIENTE_MS = 2 * 60 * 60 * 1000;

const TRANSICIONES: Record<EstadoEnvio, EstadoEnvio[]> = {
  PENDIENTE: ['SUBIENDO', 'MANUAL', 'ERROR', 'CONFIRMADO'],
  SUBIENDO: ['CONFIRMADO', 'ERROR', 'MANUAL'],
  ERROR: ['PENDIENTE', 'SUBIENDO', 'MANUAL', 'CONFIRMADO'],
  MANUAL: ['CONFIRMADO', 'ERROR'],
  CONFIRMADO: [],
};

export type EnvioDoc = {
  estado?: EstadoEnvio;
  origen?: OrigenEnvio | null;
  tipo?: 'AT' | 'BT';
  txt?: string;
  intentos?: unknown[];
  token?: string | null;
  tokenExpiraAt?: string | null;
  tokenUsadoAt?: string | null;
  constanciaUrl?: string | null;
  empresaNombre?: string;
  fechaAlta?: string | null;
  fechaBaja?: string | null;
  advertencias?: string[];
};

/** `strictNullChecks: false` en este paquete: los resultados no son uniones discriminadas. */
export type ResultadoTransicion = { ok: boolean; codigo?: string; patch?: Record<string, unknown> };
export type ResultadoToken = { ok: boolean; codigo?: string };

export function transicionEnvio(
  envio: EnvioDoc,
  input: {
    estado: EstadoEnvio;
    origen?: OrigenEnvio;
    nroTransaccion?: string;
    constanciaUrl?: string | null;
    error?: string | null;
    actor?: string | null;
    at?: string;
  },
): ResultadoTransicion {
  const actual = (envio?.estado || 'PENDIENTE') as EstadoEnvio;
  if (!ESTADOS_ENVIO.includes(input.estado)) return { ok: false, codigo: 'ESTADO_DESCONOCIDO' };
  if (!(TRANSICIONES[actual] || []).includes(input.estado)) {
    return { ok: false, codigo: 'TRANSICION_INVALIDA' };
  }
  if (input.estado === 'CONFIRMADO' && !String(input.nroTransaccion || '').trim()) {
    return { ok: false, codigo: 'FALTA_NRO_TRANSACCION' };
  }
  const intento = {
    estado: input.estado,
    origen: input.origen || envio.origen || 'MANUAL',
    at: input.at || new Date().toISOString(),
    actor: input.actor || null,
    error: input.error || null,
  };
  const patch: Record<string, unknown> = {
    estado: input.estado,
    origen: intento.origen,
    intentos: [...(envio.intentos || []), intento],
  };
  if (input.estado === 'CONFIRMADO') {
    patch.nroTransaccion = String(input.nroTransaccion).trim();
    patch.constanciaUrl = input.constanciaUrl || envio.constanciaUrl || null;
    patch.token = null;
  }
  if (input.estado === 'ERROR') patch.ultimoError = input.error || 'SIN_DETALLE';
  return { ok: true, patch };
}

export function validarToken(envio: EnvioDoc | null, token: string, nowMs: number): ResultadoToken {
  if (!envio) return { ok: false, codigo: 'NO_EXISTE' };
  if (!envio.token || !token || envio.token !== token) return { ok: false, codigo: 'TOKEN_INVALIDO' };
  if (envio.tokenUsadoAt) return { ok: false, codigo: 'TOKEN_USADO' };
  if (envio.estado === 'CONFIRMADO') return { ok: false, codigo: 'YA_CONFIRMADO' };
  const vence = Date.parse(envio.tokenExpiraAt || '');
  if (!Number.isFinite(vence) || nowMs > vence) return { ok: false, codigo: 'TOKEN_VENCIDO' };
  return { ok: true };
}

/** Lo que ve la página pública: sin CUIL, sin nombre del vigilador, sin importes. */
export function vistaPublicaEnvio(envio: EnvioDoc): Record<string, unknown> {
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

/** Token de un solo uso para la carga manual. */
export function nuevoToken(nowMs: number): { token: string; tokenExpiraAt: string; tokenUsadoAt: null } {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(32);
  let token = '';
  for (const b of bytes) token += abc[b % abc.length];
  return { token, tokenExpiraAt: new Date(nowMs + TOKEN_VIGENCIA_MS).toISOString(), tokenUsadoAt: null };
}

/** Ventana fija por clave. Sin Redis: alcanza para un robot cada 5 min. */
const hits = new Map<string, number[]>();

export function rateLimitHit(clave: string, nowMs: number, max = 30, ventanaMs = 60_000): boolean {
  const previos = (hits.get(clave) || []).filter((t) => nowMs - t < ventanaMs);
  if (previos.length >= max) {
    hits.set(clave, previos);
    return false;
  }
  previos.push(nowMs);
  hits.set(clave, previos);
  return true;
}
