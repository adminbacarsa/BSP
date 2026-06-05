"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupClientByCuitHandler = lookupClientByCuitHandler;
const functions = require("firebase-functions/v1");
const backup_auth_util_1 = require("../backup/backup-auth.util");
const lookupTaxpayer_1 = require("./lookupTaxpayer");
async function lookupClientByCuitHandler(data, context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    if (!caller.isPanelUser) {
        throw new functions.https.HttpsError('permission-denied', 'Solo usuarios del panel de administración pueden consultar AFIP.');
    }
    try {
        const empresaId = String(data?.empresaId ?? '').trim();
        const result = await (0, lookupTaxpayer_1.lookupTaxpayerByCuit)(data?.cuit, empresaId);
        return { ok: true, ...result };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/no encontrado|no existe persona|no está en el padrón|no figura en el padrón/i.test(msg)) {
            throw new functions.https.HttpsError('not-found', msg);
        }
        if (/inválido|invalido/i.test(msg)) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        if (/no configurado|certificado afip|AFIP rechazó|AFIP denegó|aún no vigente|vencido/i.test(msg)) {
            throw new functions.https.HttpsError('failed-precondition', msg);
        }
        console.error('[lookupClientByCuit]', e);
        throw new functions.https.HttpsError('failed-precondition', msg.slice(0, 400) || 'Error al consultar AFIP.');
    }
}
//# sourceMappingURL=lookupClientByCuitHandler.js.map