"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAltaArcaConfirmada = isAltaArcaConfirmada;
exports.altaArcaPendienteAlerta = altaArcaPendienteAlerta;
const arcaEnviosCore_1 = require("./arcaEnviosCore");
function isAltaArcaConfirmada(shift) {
    if (!shift || shift.esEventual !== true)
        return true;
    return shift.eventualAltaArcaConfirmada === true;
}
function altaArcaPendienteAlerta(shift, nowMs) {
    if (isAltaArcaConfirmada(shift))
        return null;
    const start = shift.startTime?.toMillis?.() ?? 0;
    if (!start)
        return null;
    if (nowMs < start - arcaEnviosCore_1.ALERTA_ALTA_PENDIENTE_MS)
        return null;
    return {
        tipo: 'ALTA_ARCA_PENDIENTE',
        prioridad: 'ALTA',
        contratoId: shift.eventualContratoId || null,
        minutosAlInicio: Math.round((start - nowMs) / 60000),
    };
}
//# sourceMappingURL=altaArcaGate.js.map