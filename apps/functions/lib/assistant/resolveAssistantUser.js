"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAssistantUser = resolveAssistantUser;
exports.empresaAllowed = empresaAllowed;
const admin = require("firebase-admin");
const role_util_1 = require("../common/role.util");
const cospKnowledge_1 = require("./cospKnowledge");
function roleHasAssistantRead(perms) {
    const a = perms.ASSISTANT;
    return Array.isArray(a) && a.includes('read');
}
async function authClaimRole(uid) {
    try {
        const u = await admin.auth().getUser(uid);
        return String((u.customClaims ?? {}).role ?? '').trim();
    }
    catch {
        return '';
    }
}
async function resolveAssistantUser(uid, opts) {
    const db = admin.firestore();
    const tokenRole = String(opts?.tokenRole ?? '').trim();
    const claimRole = tokenRole || (await authClaimRole(uid));
    const sys = await db.collection('system_users').doc(uid).get();
    if (sys.exists) {
        const role = String(sys.data()?.role || '');
        let isSuper = (0, role_util_1.isSuperAdminRole)(role) || (0, role_util_1.isSuperAdminRole)(claimRole);
        let empresaId = String(sys.data()?.empresaId ?? '').trim() || (!isSuper ? 'bacarsa' : '');
        let readableModuleKeys;
        let canUseAssistant = isSuper;
        if (isSuper || !role) {
            readableModuleKeys = [...cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS];
            canUseAssistant = true;
        }
        else {
            const roleSnap = await db.collection('roles').doc((0, role_util_1.normalizeRoleId)(role)).get();
            const perms = (roleSnap.data()?.permissions ?? {});
            const roleEmp = String(roleSnap.data()?.empresaId ?? '').trim();
            if (roleEmp && empresaId && roleEmp.toLowerCase() !== empresaId.toLowerCase()) {
                readableModuleKeys = ['DASHBOARD'];
                canUseAssistant = false;
            }
            else {
                canUseAssistant = roleHasAssistantRead(perms);
                readableModuleKeys = cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS.filter((k) => {
                    const a = perms[k];
                    return Array.isArray(a) && a.includes('read');
                });
                if (!roleSnap.exists || readableModuleKeys.length === 0) {
                    readableModuleKeys =
                        cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS.length > 0 ? ['DASHBOARD'] : readableModuleKeys;
                }
            }
        }
        if (!canUseAssistant && (0, role_util_1.isSuperAdminRole)(claimRole)) {
            isSuper = true;
            canUseAssistant = true;
            readableModuleKeys = [...cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS];
        }
        return {
            persona: 'SYSTEM',
            roleName: role || claimRole || null,
            empresaId,
            readableModuleKeys,
            canUseAssistant,
            isSuperAdmin: isSuper,
            summaryLabel: role ? `Usuario sistema (${role})` : 'Usuario sistema',
        };
    }
    const clientSnap = await db.collection('client_users').where('uid', '==', uid).limit(1).get();
    if (!clientSnap.empty) {
        const d = clientSnap.docs[0].data();
        return {
            persona: 'CLIENT',
            roleName: 'client_portal',
            empresaId: String(d.clientId ?? d.clienteId ?? d.empresaId ?? ''),
            readableModuleKeys: ['CLIENT_PORTAL'],
            canUseAssistant: true,
            isSuperAdmin: false,
            summaryLabel: 'Portal cliente',
        };
    }
    const empSnap = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    if (!empSnap.empty) {
        const d = empSnap.docs[0].data();
        return {
            persona: 'EMPLOYEE',
            roleName: 'empleado_portal',
            empresaId: String(d.empresaId ?? ''),
            readableModuleKeys: ['EMPLOYEE_PORTAL'],
            canUseAssistant: true,
            isSuperAdmin: false,
            summaryLabel: 'Colaborador (portal empleado)',
        };
    }
    const authSuper = await tryResolveSuperAdminFromAuth(uid, claimRole);
    if (authSuper)
        return authSuper;
    return null;
}
async function tryResolveSuperAdminFromAuth(uid, claimRole) {
    if (!(0, role_util_1.isSuperAdminRole)(claimRole))
        return null;
    let empresaId = '';
    try {
        const u = await admin.auth().getUser(uid);
        const claims = (u.customClaims ?? {});
        empresaId = String(claims.empresaId ?? '').trim();
    }
    catch {
    }
    return {
        persona: 'SYSTEM',
        roleName: claimRole || 'SUPERADMIN',
        empresaId,
        readableModuleKeys: [...cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS],
        canUseAssistant: true,
        isSuperAdmin: true,
        summaryLabel: process.env.FUNCTIONS_EMULATOR === 'true'
            ? 'Superadmin (emulador vía Auth; sin system_users en Firestore)'
            : 'Superadmin (vía Auth claim)',
    };
}
function empresaAllowed(claimedEmpresaId, profile) {
    const c = String(claimedEmpresaId ?? '').trim();
    if (profile.persona === 'CLIENT')
        return true;
    if (profile.isSuperAdmin)
        return true;
    const serverEmp = profile.empresaId.trim();
    if (!serverEmp)
        return true;
    if (!c)
        return true;
    return c.toLowerCase() === serverEmp.toLowerCase();
}
//# sourceMappingURL=resolveAssistantUser.js.map