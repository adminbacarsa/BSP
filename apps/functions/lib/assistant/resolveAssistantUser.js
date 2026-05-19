"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAssistantUser = resolveAssistantUser;
exports.empresaAllowed = empresaAllowed;
const admin = require("firebase-admin");
const cospKnowledge_1 = require("./cospKnowledge");
function normalizeRoleId(role) {
    return role.trim().toUpperCase().replace(/\s+/g, '_');
}
function roleHasAssistantRead(perms) {
    const a = perms.ASSISTANT;
    return Array.isArray(a) && a.includes('read');
}
async function resolveAssistantUser(uid) {
    const db = admin.firestore();
    const sys = await db.collection('system_users').doc(uid).get();
    if (sys.exists) {
        const role = String(sys.data()?.role || '');
        const isSuper = normalizeRoleId(role) === 'SUPERADMIN' || normalizeRoleId(role) === 'SUPER_ADMIN';
        let empresaId = String(sys.data()?.empresaId ?? '').trim() || (!isSuper ? 'bacarsa' : '');
        let readableModuleKeys;
        let canUseAssistant = isSuper;
        if (isSuper || !role) {
            readableModuleKeys = [...cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS];
        }
        else {
            const roleSnap = await db.collection('roles').doc(normalizeRoleId(role)).get();
            const perms = (roleSnap.data()?.permissions ?? {});
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
        return {
            persona: 'SYSTEM',
            roleName: role || null,
            empresaId,
            readableModuleKeys,
            canUseAssistant,
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
            summaryLabel: 'Colaborador (portal empleado)',
        };
    }
    const emulatorAuth = await tryResolveAssistantFromEmulatorAuth(uid);
    if (emulatorAuth)
        return emulatorAuth;
    return null;
}
async function tryResolveAssistantFromEmulatorAuth(uid) {
    if (process.env.FUNCTIONS_EMULATOR !== 'true')
        return null;
    try {
        const u = await admin.auth().getUser(uid);
        const claims = (u.customClaims ?? {});
        const role = String(claims.role ?? '').trim();
        const isSuper = normalizeRoleId(role) === 'SUPERADMIN' || normalizeRoleId(role) === 'SUPER_ADMIN';
        if (isSuper) {
            const empresaId = String(claims.empresaId ?? '').trim() || 'bacarsa';
            return {
                persona: 'SYSTEM',
                roleName: role || 'SUPERADMIN',
                empresaId,
                readableModuleKeys: [...cospKnowledge_1.KNOWN_ADMIN_MODULE_KEYS],
                canUseAssistant: true,
                summaryLabel: 'Superadmin (emulador vía Auth; sin system_users en Firestore)',
            };
        }
    }
    catch {
        return null;
    }
    return null;
}
function empresaAllowed(claimedEmpresaId, profile) {
    const c = String(claimedEmpresaId ?? '').trim();
    if (profile.persona === 'CLIENT')
        return true;
    const serverEmp = profile.empresaId.trim();
    if (!serverEmp)
        return true;
    if (!c)
        return true;
    return c.toLowerCase() === serverEmp.toLowerCase();
}
//# sourceMappingURL=resolveAssistantUser.js.map