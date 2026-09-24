"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelLlegadaTardeConvocatorias = cancelLlegadaTardeConvocatorias;
const firestore_1 = require("firebase-admin/firestore");
async function cancelLlegadaTardeConvocatorias(db, shiftId, reason) {
    const sid = String(shiftId || '').trim();
    if (!sid)
        return 0;
    const snap = await db
        .collection('convocatorias_cobertura')
        .where('shiftId', '==', sid)
        .where('type', '==', 'LLEGADA_TARDE')
        .where('status', '==', 'PENDING')
        .limit(5)
        .get();
    if (snap.empty)
        return 0;
    const batch = db.batch();
    for (const d of snap.docs) {
        batch.update(d.ref, {
            status: 'CANCELLED',
            cancelReason: reason,
            cancelledAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    return snap.size;
}
//# sourceMappingURL=cancelLlegadaTardeConvocatorias.js.map