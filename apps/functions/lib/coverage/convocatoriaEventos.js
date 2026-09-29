"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canalOrigenConvocatoria = canalOrigenConvocatoria;
exports.logConvocatoriaEvento = logConvocatoriaEvento;
const firestore_1 = require("firebase-admin/firestore");
function canalOrigenConvocatoria(createdBy) {
    const by = String(createdBy || '').trim();
    if (by === 'AUTO')
        return 'AUTO';
    if (by === 'MODO_DEMO')
        return 'DEMO';
    return 'CC';
}
async function logConvocatoriaEvento(db, convocatoriaId, event) {
    const id = String(convocatoriaId || '').trim();
    if (!id)
        return;
    const { at, ...rest } = event;
    const clean = { at: at || firestore_1.FieldValue.serverTimestamp() };
    for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined)
            clean[key] = value;
    }
    await db.collection('convocatorias_cobertura').doc(id).collection('eventos').add(clean);
}
//# sourceMappingURL=convocatoriaEventos.js.map