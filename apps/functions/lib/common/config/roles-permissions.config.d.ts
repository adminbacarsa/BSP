export declare const PERMISSIONS: {
    readonly VIEW_DASHBOARD: "view_dashboard";
    readonly MANAGE_SHIFTS: "manage_shifts";
    readonly AUDIT_GPS: "audit_gps";
    readonly VIEW_EMPLOYEES: "view_employees";
    readonly MANAGE_EMPLOYEES: "manage_employees";
    readonly MANAGE_ABSENCES: "manage_absences";
    readonly VIEW_AUDIT: "view_audit";
    readonly MANAGE_USERS: "manage_users";
    readonly MANAGE_ROLES: "manage_roles";
};
export declare const ROLES_CONFIG: {
    SuperAdmin: string[];
    Director: ("view_dashboard" | "audit_gps" | "view_employees" | "view_audit")[];
    RRHH: ("view_dashboard" | "view_employees" | "manage_employees" | "manage_absences")[];
    Scheduler: ("view_dashboard" | "manage_shifts" | "view_employees")[];
    Auditor: ("audit_gps" | "view_audit")[];
};
