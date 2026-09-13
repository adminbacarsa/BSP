"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.docEmpresaId = docEmpresaId;
exports.assertPanelTenantCallable = assertPanelTenantCallable;
exports.loadDocAndAssertEmpresa = loadDocAndAssertEmpresa;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const backup_auth_util_1 = require("../backup/backup-auth.util");
function docEmpresaId(data) {
    return String(data?.empresaId ?? '').trim();
}
async function bacarsaLegacyOpen(db) {
    const snap = await db.collection('empresas').doc('bacarsa').get();
    return snap.exists && snap.data()?.migracionCompleta !== true;
}
function bacarsaTenantDocMatches(userEmpresaId, data) {
    if (userEmpresaId !== 'bacarsa')
        return false;
    const docEmp = docEmpresaId(data);
    return docEmp === '' || docEmp === 'bacarsa';
}
async function tenantMatchesDoc(db, caller, uid, data, tokenEmpresaId) {
    if (caller.isSuper)
        return true;
    const sysSnap = await db.collection('system_users').doc(uid).get();
    if (sysSnap.exists && sysSnap.data()?.allEmpresas === true)
        return true;
    const userEmpresaId = caller.profileEmpresa || String(tokenEmpresaId || '').trim();
    if (!userEmpresaId)
        return false;
    const docEmp = docEmpresaId(data);
    if (docEmp === userEmpresaId)
        return true;
    if (bacarsaTenantDocMatches(userEmpresaId, data))
        return true;
    if (userEmpresaId === 'bacarsa' && docEmp === '' && (await bacarsaLegacyOpen(db))) {
        return true;
    }
    return false;
}
async function assertPanelTenantCallable(context, empresaId, resourceData, deniedMessage = 'Solo usuarios del panel pueden ejecutar esta operación.') {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    if (!caller.isPanelUser) {
        throw new functions.https.HttpsError('permission-denied', deniedMessage);
    }
    const reqEmpresa = String(empresaId || '').trim();
    if (!reqEmpresa) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido.');
    }
    const db = admin.firestore();
    const tokenEmpresaId = String(context.auth.token?.empresaId || '').trim();
    const canAccessReq = await tenantMatchesDoc(db, caller, context.auth.uid, { empresaId: reqEmpresa }, tokenEmpresaId);
    if (!canAccessReq) {
        throw new functions.https.HttpsError('permission-denied', 'Empresa no autorizada para este operador.');
    }
    if (!resourceData)
        return;
    const resourceOk = await tenantMatchesDoc(db, caller, context.auth.uid, resourceData, tokenEmpresaId);
    if (!resourceOk) {
        throw new functions.https.HttpsError('permission-denied', 'No tenés acceso al recurso solicitado.');
    }
    const resourceEmp = docEmpresaId(resourceData);
    if (resourceEmp && resourceEmp !== reqEmpresa) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId no coincide con el recurso.');
    }
}
async function loadDocAndAssertEmpresa(collection, docId, empresaId) {
    const db = admin.firestore();
    const snap = await db.collection(collection).doc(docId).get();
    if (!snap.exists) {
        throw new Error(`${collection}/${docId} no encontrado.`);
    }
    const data = snap.data();
    const reqEmp = String(empresaId || '').trim();
    const docEmp = docEmpresaId(data);
    if (docEmp && docEmp !== reqEmp) {
        throw new Error('El recurso no pertenece a la empresa indicada.');
    }
    if (!docEmp) {
        const legacyOpen = await bacarsaLegacyOpen(db);
        if (!(reqEmp === 'bacarsa' && legacyOpen)) {
            throw new Error('El recurso no tiene empresa asignada.');
        }
    }
    return data;
}
//# sourceMappingURL=panel-tenant-auth.util.js.map