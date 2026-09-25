"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAFF_APP_MODULE_KEYS = void 0;
exports.fullStaffModulePermissions = fullStaffModulePermissions;
exports.moduleActionsFromRolePermissions = moduleActionsFromRolePermissions;
exports.buildStaffModulesPayload = buildStaffModulesPayload;
exports.resolvePanelUserForUid = resolvePanelUserForUid;
exports.assertOperationsUpdatePermission = assertOperationsUpdatePermission;
const functions = require("firebase-functions/v1");
const role_util_1 = require("../common/role.util");
exports.STAFF_APP_MODULE_KEYS = ['OPERATIONS', 'SUPERVISION', 'RRHH', 'PLANNING'];
const BASE_ACTIONS = ['read', 'create', 'update', 'delete'];
const MODULE_ONLY_ACTIONS = {
    PLANNING: ['publish', 'correct', 'auto_lab', 'assign_ft'],
    RRHH: ['adjust'],
};
function fullStaffModulePermissions() {
    const out = {};
    for (const key of exports.STAFF_APP_MODULE_KEYS) {
        const extra = MODULE_ONLY_ACTIONS[key] ?? [];
        out[key] = [...BASE_ACTIONS, ...extra];
    }
    return out;
}
function moduleActionsFromRolePermissions(permissions, moduleKey) {
    const raw = permissions[moduleKey];
    if (!Array.isArray(raw))
        return [];
    const allowed = new Set([...BASE_ACTIONS, ...(MODULE_ONLY_ACTIONS[moduleKey] ?? [])]);
    return raw.filter((a) => typeof a === 'string' && allowed.has(a));
}
function buildStaffModulesPayload(permissions) {
    const out = {};
    for (const key of exports.STAFF_APP_MODULE_KEYS) {
        out[key] = moduleActionsFromRolePermissions(permissions, key);
    }
    return out;
}
async function resolvePanelUserForUid(db, uid, tokenRoleRaw) {
    const tokenRole = String(tokenRoleRaw ?? '').trim();
    const sys = await db.collection('system_users').doc(uid).get();
    if (!sys.exists)
        return null;
    const data = sys.data() ?? {};
    const role = String(data.role || '').trim();
    const allEmpresas = data.allEmpresas === true;
    let isSuper = (0, role_util_1.isSuperAdminRole)(role) || (0, role_util_1.isSuperAdminRole)(tokenRole);
    let permissions = {};
    if (isSuper) {
        permissions = fullStaffModulePermissions();
        const superKeys = [
            'DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS',
            'SERVICES', 'REPORTS', 'ANALYSIS', 'ASSISTANT', 'CONFIG', 'SUPERVISION',
        ];
        for (const k of superKeys) {
            if (!permissions[k]) {
                permissions[k] = [...BASE_ACTIONS, ...(MODULE_ONLY_ACTIONS[k] ?? [])];
            }
        }
        permissions.PLANNING = [...BASE_ACTIONS, ...MODULE_ONLY_ACTIONS.PLANNING];
        permissions.RRHH = [...BASE_ACTIONS, ...MODULE_ONLY_ACTIONS.RRHH];
    }
    else if (role) {
        const roleSnap = await db.collection('roles').doc((0, role_util_1.normalizeRoleId)(role)).get();
        if (roleSnap.exists) {
            const roleData = roleSnap.data() ?? {};
            const roleEmp = String(roleData.empresaId ?? '').trim();
            const userEmp = String(data.empresaId || 'bacarsa').trim();
            if (!allEmpresas && roleEmp && userEmp && roleEmp.toLowerCase() !== userEmp.toLowerCase()) {
                permissions = {};
            }
            else {
                permissions = (roleData.permissions ?? {});
            }
        }
    }
    if (!isSuper && (0, role_util_1.isSuperAdminRole)(tokenRole)) {
        isSuper = true;
        permissions = fullStaffModulePermissions();
    }
    const operatorName = String(data.displayName || data.name || data.email || '').trim()
        || String(data.email || '').split('@')[0]
        || 'Operador';
    const empresaId = isSuper || allEmpresas
        ? String(data.empresaId ?? '').trim()
        : String(data.empresaId || 'bacarsa').trim();
    return {
        isSuperAdmin: isSuper,
        allEmpresas,
        empresaId,
        roleName: role || tokenRole,
        permissions,
        operatorName,
    };
}
async function assertOperationsUpdatePermission(db, uid, empresaId, tokenRoleRaw) {
    const panel = await resolvePanelUserForUid(db, uid, tokenRoleRaw);
    if (!panel) {
        throw new functions.https.HttpsError('permission-denied', 'Usuario no autorizado en el panel.');
    }
    const eid = String(empresaId || '').trim();
    if (!eid) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido.');
    }
    if (!panel.isSuperAdmin && !panel.allEmpresas) {
        const userEmp = String(panel.empresaId || 'bacarsa').trim();
        if (userEmp && eid.toLowerCase() !== userEmp.toLowerCase()) {
            throw new functions.https.HttpsError('permission-denied', 'Empresa no permitida para este usuario.');
        }
    }
    if (panel.isSuperAdmin)
        return panel;
    const ops = panel.permissions.OPERATIONS;
    if (!Array.isArray(ops) || !ops.includes('update')) {
        throw new functions.https.HttpsError('permission-denied', 'Se requiere permiso OPERATIONS:update.');
    }
    return panel;
}
//# sourceMappingURL=staffPermissions.js.map