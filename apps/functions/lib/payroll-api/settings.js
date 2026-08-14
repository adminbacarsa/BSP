"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEmpresaHoursMode = resolveEmpresaHoursMode;
const admin = require("firebase-admin");
async function resolveEmpresaHoursMode(empresaId) {
    const id = String(empresaId || '').trim();
    if (!id)
        return 'planned';
    const snap = await admin.firestore().collection('payroll_settings').doc(id).get();
    return snap.data()?.hoursMode === 'real' ? 'real' : 'planned';
}
//# sourceMappingURL=settings.js.map