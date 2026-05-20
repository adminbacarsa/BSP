"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRoleId = normalizeRoleId;
exports.isSuperAdminRole = isSuperAdminRole;
function normalizeRoleId(role) {
    return String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}
function isSuperAdminRole(role) {
    const r = normalizeRoleId(role);
    return r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || r === 'SP';
}
//# sourceMappingURL=role.util.js.map