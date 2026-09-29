"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONVOCADO_DELAY_GRACE_MIN = exports.CONVOCADO_SAME_SITE_ETA_MIN = exports.CONVOCADO_ETA_WAIT_MIN = exports.CONVOCADO_ETA_SPEED_KMH = void 0;
exports.haversineKm = haversineKm;
exports.busEtaMinutes = busEtaMinutes;
exports.convocadoTravelEta = convocadoTravelEta;
exports.convocadoReminderAtMs = convocadoReminderAtMs;
exports.CONVOCADO_ETA_SPEED_KMH = 20;
exports.CONVOCADO_ETA_WAIT_MIN = 10;
exports.CONVOCADO_SAME_SITE_ETA_MIN = 5;
exports.CONVOCADO_DELAY_GRACE_MIN = 15;
function haversineKm(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every((n) => Number.isFinite(n)))
        return null;
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function busEtaMinutes(distanceKm, speedKmh = exports.CONVOCADO_ETA_SPEED_KMH, waitMin = exports.CONVOCADO_ETA_WAIT_MIN) {
    const speed = speedKmh > 0 ? speedKmh : exports.CONVOCADO_ETA_SPEED_KMH;
    const wait = waitMin >= 0 ? waitMin : exports.CONVOCADO_ETA_WAIT_MIN;
    if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0.05)
        return Math.max(1, Math.round(wait));
    return Math.max(1, Math.round((distanceKm / speed) * 60 + wait));
}
function convocadoTravelEta(input) {
    const ct = String(input.coverageType || '').toUpperCase();
    if ((ct === 'ESC' || ct === 'REF') && input.sameObjective) {
        return { etaMinutes: exports.CONVOCADO_SAME_SITE_ETA_MIN, traveled: false };
    }
    return {
        etaMinutes: busEtaMinutes(input.distanceKm, input.speedKmh, input.waitMin),
        traveled: true,
    };
}
function convocadoReminderAtMs(acceptedAtMs, etaMinutes) {
    const eta = Math.max(1, etaMinutes);
    return acceptedAtMs + Math.round((eta * 2) / 3) * 60 * 1000;
}
//# sourceMappingURL=convocadoEta.js.map