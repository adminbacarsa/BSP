"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSlaUnplannedGapDocId = buildSlaUnplannedGapDocId;
function buildSlaUnplannedGapDocId(params) {
    const normPos = String(params.positionName ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return `gap_${params.empresaId}_${params.objectiveId}_${normPos}_${params.dayYmd}_${String(params.bandCode || '').toUpperCase()}`
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 120);
}
//# sourceMappingURL=slaGapId.js.map