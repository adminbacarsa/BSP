"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hoursRemainingUntilEnd = hoursRemainingUntilEnd;
exports.resolveEarlyWithdrawReplacePolicy = resolveEarlyWithdrawReplacePolicy;
exports.rrhhPartialForReason = rrhhPartialForReason;
function hoursRemainingUntilEnd(nowMs, endMs) {
    if (!endMs || endMs <= nowMs)
        return 0;
    return (endMs - nowMs) / 3600000;
}
function resolveEarlyWithdrawReplacePolicy(opts) {
    const h = opts.hoursLeft;
    const alone = opts.colleaguesPresent <= 0;
    if (h < 2 && !alone)
        return 'NO_REPLACE';
    if (alone || h > 3) {
        return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
    }
    if (h >= 2 && h <= 3) {
        if (opts.reemplazarRetiro2a3h === true) {
            return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
        }
        if (opts.reemplazarRetiro2a3h === false)
            return 'NO_REPLACE';
        if (opts.isAutoMode)
            return 'AUTO_REPLACE';
        if (typeof opts.operatorReplaceChoice === 'boolean') {
            return opts.operatorReplaceChoice ? 'REPLACE' : 'NO_REPLACE';
        }
        return 'OPERATOR_CHOICE';
    }
    if (h < 2 && alone) {
        return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
    }
    return opts.isAutoMode ? 'AUTO_REPLACE' : 'REPLACE';
}
function rrhhPartialForReason(reason) {
    switch (reason) {
        case 'ENFERMEDAD':
            return { absenceType: 'E', typeLabel: 'Retiro Anticipado (Parcial — Enfermedad)', disciplinary: false };
        case 'ABANDONO':
            return {
                absenceType: 'AA',
                typeLabel: 'Retiro Anticipado (Parcial — Abandono)',
                disciplinary: true,
            };
        case 'FAMILIAR':
        case 'OPERATIVO':
        case 'AUTORIZADO':
        default:
            return { absenceType: 'A', typeLabel: 'Retiro Anticipado (Parcial — Autorizado)', disciplinary: false };
    }
}
//# sourceMappingURL=earlyWithdrawPolicy.js.map