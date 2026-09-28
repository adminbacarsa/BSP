"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncTurnoClientOwner = void 0;
const firestore_1 = require("firebase-admin/firestore");
const firestore_2 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const turnoClientOwner_1 = require("./turnoClientOwner");
function toWrite(patch) {
    const out = {};
    if (patch.clientId)
        out.clientId = patch.clientId;
    if (patch.integrityIssue === null)
        out.integrityIssue = firestore_1.FieldValue.delete();
    else if (patch.integrityIssue)
        out.integrityIssue = patch.integrityIssue;
    return out;
}
exports.syncTurnoClientOwner = (0, firestore_2.onDocumentWritten)({
    document: 'turnos/{turnoId}',
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
}, async (event) => {
    const after = event.data?.after;
    if (!after?.exists)
        return;
    const data = (after.data() || {});
    await (0, turnoClientOwner_1.correctTurnoClientId)(admin.firestore(), after.ref, data, toWrite);
});
//# sourceMappingURL=syncTurnoClientOwner.js.map