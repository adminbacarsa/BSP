"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCentroControlEnabled = isCentroControlEnabled;
exports.loadCentroControlState = loadCentroControlState;
function isCentroControlEnabled(data) {
    if (!data)
        return true;
    return data.centroControlEnabled !== false;
}
async function loadCentroControlState(db) {
    const snap = await db.collection('empresas').get();
    const disabled = new Set();
    snap.docs.forEach((d) => {
        if (!isCentroControlEnabled(d.data()))
            disabled.add(d.id);
    });
    const anyEnabled = snap.empty || snap.docs.some((d) => isCentroControlEnabled(d.data()));
    return {
        anyEnabled,
        isEnabled: (empresaId) => {
            const id = String(empresaId || '').trim() || 'bacarsa';
            return !disabled.has(id);
        },
    };
}
//# sourceMappingURL=centroControlGuard.js.map