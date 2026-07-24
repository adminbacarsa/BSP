"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBackupRole = normalizeBackupRole;
exports.isSuperAdminBackupRole = isSuperAdminBackupRole;
exports.isAdminBackupRole = isAdminBackupRole;
exports.resolveBackupCaller = resolveBackupCaller;
exports.assertBackupCallableAllowed = assertBackupCallableAllowed;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
function normalizeBackupRole(role) {
    return String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}
function isSuperAdminBackupRole(role) {
    const r = normalizeBackupRole(role);
    return r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || r === 'SP';
}
function isAdminBackupRole(role) {
    const r = normalizeBackupRole(role);
    return isSuperAdminBackupRole(r) || r === 'ADMIN';
}
async function resolveBackupCaller(uid, tokenRoleRaw) {
    const tokenRole = normalizeBackupRole(tokenRoleRaw);
    let isSuper = isSuperAdminBackupRole(tokenRole);
    let profileEmpresa = '';
    let sysRole = '';
    const db = admin.firestore();
    const sysUser = await db.collection('system_users').doc(uid).get();
    if (sysUser.exists) {
        sysRole = normalizeBackupRole(sysUser.data()?.role);
        isSuper = isSuper || isSuperAdminBackupRole(sysRole);
        profileEmpresa = String(sysUser.data()?.empresaId ?? '').trim();
        return { isPanelUser: true, isSuper, profileEmpresa, sysRole };
    }
    try {
        const authUser = await admin.auth().getUser(uid);
        const claimRole = normalizeBackupRole(authUser.customClaims?.role);
        if (isAdminBackupRole(claimRole)) {
            isSuper = isSuper || isSuperAdminBackupRole(claimRole);
            sysRole = claimRole;
            return { isPanelUser: true, isSuper, profileEmpresa, sysRole };
        }
    }
    catch {
    }
    if (isAdminBackupRole(tokenRole)) {
        sysRole = tokenRole;
        return { isPanelUser: true, isSuper, profileEmpresa, sysRole };
    }
    return { isPanelUser: false, isSuper: false, profileEmpresa: '', sysRole: '' };
}
async function assertBackupCallableAllowed(auth) {
    if (!auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Autenticación requerida');
    }
    const caller = await resolveBackupCaller(auth.uid, auth.token?.role);
    if (!caller.isPanelUser) {
        throw new https_1.HttpsError('permission-denied', 'Solo usuarios del panel de administración pueden usar backups.');
    }
}
//# sourceMappingURL=backup-auth.util.js.map