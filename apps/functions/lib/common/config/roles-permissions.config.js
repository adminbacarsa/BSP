"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLES_CONFIG = exports.PERMISSIONS = void 0;
exports.PERMISSIONS = {
    VIEW_DASHBOARD: 'view_dashboard',
    MANAGE_SHIFTS: 'manage_shifts',
    AUDIT_GPS: 'audit_gps',
    VIEW_EMPLOYEES: 'view_employees',
    MANAGE_EMPLOYEES: 'manage_employees',
    MANAGE_ABSENCES: 'manage_absences',
    VIEW_AUDIT: 'view_audit',
    MANAGE_USERS: 'manage_users',
    MANAGE_ROLES: 'manage_roles',
};
exports.ROLES_CONFIG = {
    'SuperAdmin': ['ALL'],
    'Director': [
        exports.PERMISSIONS.VIEW_DASHBOARD,
        exports.PERMISSIONS.VIEW_AUDIT,
        exports.PERMISSIONS.AUDIT_GPS,
        exports.PERMISSIONS.VIEW_EMPLOYEES
    ],
    'RRHH': [
        exports.PERMISSIONS.VIEW_DASHBOARD,
        exports.PERMISSIONS.VIEW_EMPLOYEES,
        exports.PERMISSIONS.MANAGE_EMPLOYEES,
        exports.PERMISSIONS.MANAGE_ABSENCES
    ],
    'Scheduler': [
        exports.PERMISSIONS.VIEW_DASHBOARD,
        exports.PERMISSIONS.MANAGE_SHIFTS,
        exports.PERMISSIONS.VIEW_EMPLOYEES
    ],
    'Auditor': [
        exports.PERMISSIONS.VIEW_AUDIT,
        exports.PERMISSIONS.AUDIT_GPS
    ]
};
//# sourceMappingURL=roles-permissions.config.js.map