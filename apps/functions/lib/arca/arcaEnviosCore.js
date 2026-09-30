"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALERTA_ALTA_PENDIENTE_MS = exports.TOKEN_VIGENCIA_MS = exports.ESTADOS_ENVIO = void 0;
exports.transicionEnvio = transicionEnvio;
exports.validarToken = validarToken;
exports.vistaPublicaEnvio = vistaPublicaEnvio;
exports.nuevoToken = nuevoToken;
exports.rateLimitHit = rateLimitHit;
const crypto_1 = require("crypto");
exports.ESTADOS_ENVIO = ['PENDIENTE', 'SUBIENDO', 'CONFIRMADO', 'ERROR', 'MANUAL'];
exports.TOKEN_VIGENCIA_MS = 48 * 60 * 60 * 1000;
exports.ALERTA_ALTA_PENDIENTE_MS = 2 * 60 * 60 * 1000;
const TRANSICIONES = {
    PENDIENTE: ['SUBIENDO', 'MANUAL', 'ERROR', 'CONFIRMADO'],
    SUBIENDO: ['CONFIRMADO', 'ERROR', 'MANUAL'],
    ERROR: ['PENDIENTE', 'SUBIENDO', 'MANUAL', 'CONFIRMADO'],
    MANUAL: ['CONFIRMADO', 'ERROR'],
    CONFIRMADO: [],
};
function transicionEnvio(envio, input) {
    const actual = (envio?.estado || 'PENDIENTE');
    if (!exports.ESTADOS_ENVIO.includes(input.estado))
        return { ok: false, codigo: 'ESTADO_DESCONOCIDO' };
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
    const patch = {
        estado: input.estado,
        origen: intento.origen,
        intentos: [...(envio.intentos || []), intento],
    };
    if (input.estado === 'CONFIRMADO') {
        patch.nroTransaccion = String(input.nroTransaccion).trim();
        patch.constanciaUrl = input.constanciaUrl || envio.constanciaUrl || null;
        patch.token = null;
    }
    if (input.estado === 'ERROR')
        patch.ultimoError = input.error || 'SIN_DETALLE';
    return { ok: true, patch };
}
function validarToken(envio, token, nowMs) {
    if (!envio)
        return { ok: false, codigo: 'NO_EXISTE' };
    if (!envio.token || !token || envio.token !== token)
        return { ok: false, codigo: 'TOKEN_INVALIDO' };
    if (envio.tokenUsadoAt)
        return { ok: false, codigo: 'TOKEN_USADO' };
    if (envio.estado === 'CONFIRMADO')
        return { ok: false, codigo: 'YA_CONFIRMADO' };
    const vence = Date.parse(envio.tokenExpiraAt || '');
    if (!Number.isFinite(vence) || nowMs > vence)
        return { ok: false, codigo: 'TOKEN_VENCIDO' };
    return { ok: true };
}
function vistaPublicaEnvio(envio) {
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
function nuevoToken(nowMs) {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = (0, crypto_1.randomBytes)(32);
    let token = '';
    for (const b of bytes)
        token += abc[b % abc.length];
    return { token, tokenExpiraAt: new Date(nowMs + exports.TOKEN_VIGENCIA_MS).toISOString(), tokenUsadoAt: null };
}
const hits = new Map();
function rateLimitHit(clave, nowMs, max = 30, ventanaMs = 60_000) {
    const previos = (hits.get(clave) || []).filter((t) => nowMs - t < ventanaMs);
    if (previos.length >= max) {
        hits.set(clave, previos);
        return false;
    }
    previos.push(nowMs);
    hits.set(clave, previos);
    return true;
}
//# sourceMappingURL=arcaEnviosCore.js.map