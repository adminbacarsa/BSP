"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmpresaManualMode = isEmpresaManualMode;
async function isEmpresaManualMode(db, empresaId) {
    const eid = String(empresaId || '').trim();
    if (!eid)
        return false;
    const snap = await db
        .collection('sesiones_operador')
        .where('empresaId', '==', eid)
        .where('status', '==', 'ACTIVO')
        .limit(20)
        .get();
    if (snap.empty)
        return false;
    const nowMs = Date.now();
    return snap.docs.some((d) => {
        const data = d.data();
        const exp = data.expiresAt;
        if (exp?.toMillis && exp.toMillis() <= nowMs)
            return false;
        return true;
    });
}
//# sourceMappingURL=opsManualMode.js.map