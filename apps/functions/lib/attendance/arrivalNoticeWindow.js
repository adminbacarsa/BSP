"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VENIS_GRACE_MS = exports.HEADS_UP_BEFORE_MS = void 0;
exports.classifyArrivalNotice = classifyArrivalNotice;
exports.lugarAviso = lugarAviso;
exports.headsUpBody = headsUpBody;
exports.venisBody = venisBody;
exports.HEADS_UP_BEFORE_MS = 5 * 60 * 1000;
exports.VENIS_GRACE_MS = 70 * 1000;
function classifyArrivalNotice(startMs, nowMs) {
    if (!startMs || !nowMs)
        return null;
    const delta = nowMs - startMs;
    if (delta >= -exports.HEADS_UP_BEFORE_MS && delta < 0)
        return 'HEADS_UP';
    if (delta >= 0 && delta <= exports.VENIS_GRACE_MS)
        return 'VENIS';
    return null;
}
function lugarAviso(parts) {
    return [parts.clientName, parts.objectiveName, parts.positionName]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join(' · ');
}
function headsUpBody(hora, lugar, name) {
    const donde = lugar ? ` en ${lugar}` : '';
    const hello = name ? `Hola ${name} 👋 ` : '';
    return `${hello}Tu turno arranca a las ${hora}${donde}. ¿Ya estás llegando?`;
}
function venisBody(_codigo, lugar, hora, name) {
    const donde = lugar ? ` en ${lugar}` : '';
    const who = name ? `${name}, ¿venís?` : '¿Venís?';
    return `${who} Tu turno empezó a las ${hora}${donde}. Contanos si llegás en 10, 15 o 30 min.`;
}
//# sourceMappingURL=arrivalNoticeWindow.js.map