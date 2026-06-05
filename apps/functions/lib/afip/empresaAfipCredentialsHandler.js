"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveEmpresaAfipCredentialsHandler = saveEmpresaAfipCredentialsHandler;
exports.getEmpresaAfipConfigHandler = getEmpresaAfipConfigHandler;
const functions = require("firebase-functions/v1");
const backup_auth_util_1 = require("../backup/backup-auth.util");
const empresaAfipStore_1 = require("./empresaAfipStore");
function assertCanManageAfipCredentials(caller, tokenRole) {
    if (!caller.isPanelUser) {
        throw new functions.https.HttpsError('permission-denied', 'Solo usuarios del panel pueden administrar certificados AFIP.');
    }
    const role = caller.sysRole || tokenRole;
    if (!caller.isSuper && !(0, backup_auth_util_1.isAdminBackupRole)(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Solo administradores pueden cargar certificados AFIP.');
    }
}
async function saveEmpresaAfipCredentialsHandler(data, context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    assertCanManageAfipCredentials(caller, context.auth.token?.role);
    try {
        const result = await (0, empresaAfipStore_1.saveEmpresaAfipCredentials)({
            empresaId: data?.empresaId ?? '',
            certCuit: data?.certCuit ?? '',
            cert: data?.cert ?? '',
            privateKey: data?.privateKey ?? '',
            production: !!data?.production,
        });
        return { ok: true, ...result };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new functions.https.HttpsError('invalid-argument', msg.slice(0, 400));
    }
}
async function getEmpresaAfipConfigHandler(data, context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    if (!caller.isPanelUser) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const status = await (0, empresaAfipStore_1.getEmpresaAfipStatus)(String(data?.empresaId ?? '').trim());
    return { ok: true, ...status };
}
//# sourceMappingURL=empresaAfipCredentialsHandler.js.map