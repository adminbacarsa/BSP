"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retentionPendingReason = retentionPendingReason;
const TZ = 'America/Argentina/Buenos_Aires';
function formatHmAR(ms) {
    if (!ms)
        return '--:--';
    return new Date(ms).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: TZ,
    });
}
function retentionPendingReason(opts) {
    const name = String(opts.employeeName || 'relevo').trim() || 'relevo';
    if (opts.reliefStartMs > 0 && opts.nowMs < opts.reliefStartMs) {
        return `Esperando relevo de las ${formatHmAR(opts.reliefStartMs)} (${name})`;
    }
    return `${name} no se presentó`;
}
//# sourceMappingURL=retentionPendingReason.js.map