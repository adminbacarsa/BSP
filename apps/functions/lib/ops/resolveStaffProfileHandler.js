"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStaffProfileCallable = void 0;
exports.resolveStaffProfileForUid = resolveStaffProfileForUid;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
const staffPermissions_1 = require("./staffPermissions");
async function loadEmpresasForUser(db, opts) {
    const { isSuperAdmin, allEmpresas, empresaId, guardEmpresaId } = opts;
    if (isSuperAdmin || allEmpresas) {
        const snap = await db.collection('empresas').limit(200).get();
        if (!snap.empty) {
            return snap.docs.map((d) => ({
                id: d.id,
                name: String(d.data()?.name || d.id),
            }));
        }
    }
    const primary = String(empresaId || guardEmpresaId || '').trim();
    if (!primary)
        return [];
    const doc = await db.collection('empresas').doc(primary).get();
    const name = doc.exists ? String(doc.data()?.name || primary) : primary;
    return [{ id: primary, name }];
}
async function resolveStaffProfileForUid(db, uid, tokenRole) {
    const panel = await (0, staffPermissions_1.resolvePanelUserForUid)(db, uid, tokenRole);
    const empSnap = await db.collection('empleados').where('uid', '==', uid).limit(5).get();
    let employeeId;
    let guardEmpresaId = '';
    for (const d of empSnap.docs) {
        const st = String(d.data()?.status || 'ACTIVE').toUpperCase();
        if (st === 'INACTIVE')
            continue;
        employeeId = d.id;
        guardEmpresaId = String(d.data()?.empresaId || '');
        break;
    }
    const isGuard = !!employeeId;
    const isStaff = !!panel;
    const isSuperAdmin = panel?.isSuperAdmin === true;
    let modules = {};
    if (isSuperAdmin) {
        modules = (0, staffPermissions_1.fullStaffModulePermissions)();
    }
    else if (panel) {
        modules = (0, staffPermissions_1.buildStaffModulesPayload)(panel.permissions);
    }
    else {
        for (const k of staffPermissions_1.STAFF_APP_MODULE_KEYS)
            modules[k] = [];
    }
    const empresas = await loadEmpresasForUser(db, {
        isSuperAdmin,
        allEmpresas: panel?.allEmpresas === true,
        empresaId: panel?.empresaId || '',
        guardEmpresaId,
    });
    return {
        isGuard,
        ...(employeeId ? { employeeId } : {}),
        isStaff,
        isSuperAdmin,
        empresas,
        modules,
    };
}
exports.resolveStaffProfileCallable = functions.https.onCall(async (_data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
    }
    return resolveStaffProfileForUid(admin.firestore(), context.auth.uid, context.auth.token?.role);
});
//# sourceMappingURL=resolveStaffProfileHandler.js.map