"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ymCordobaParts = ymCordobaParts;
exports.buildPlanificacionEstadoDocId = buildPlanificacionEstadoDocId;
exports.planificacionEstadoLookupDocIds = planificacionEstadoLookupDocIds;
exports.planificacionEstadoLookupKey = planificacionEstadoLookupKey;
function ymCordobaParts(dt) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: 'numeric',
    }).formatToParts(dt);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    return { year, month, ym: `${year}_${month}` };
}
function buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month) {
    const e = String(empresaId ?? '').trim();
    const o = String(objectiveId ?? '').trim();
    if (e)
        return `${e}_${o}_${year}_${month}`;
    return `${o}_${year}_${month}`;
}
function planificacionEstadoLookupDocIds(empresaId, objectiveId, year, month) {
    const primary = buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month);
    const legacy = buildPlanificacionEstadoDocId('', objectiveId, year, month);
    if (legacy === primary)
        return [primary];
    return [primary, legacy];
}
function planificacionEstadoLookupKey(objectiveId, ym) {
    return `${String(objectiveId ?? '').trim()}_${ym}`;
}
//# sourceMappingURL=planificacionEstadoKeys.js.map