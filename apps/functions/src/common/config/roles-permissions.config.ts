// 1. DEFINICIÓN DE PERMISOS (Lo que se puede hacer)
export const PERMISSIONS = {
    // Dashboard
    VIEW_DASHBOARD: 'view_dashboard',
    
    // Operaciones
    MANAGE_SHIFTS: 'manage_shifts',      // Crear/Editar Turnos
    AUDIT_GPS: 'audit_gps',              // Ver mapa en vivo
    
    // RRHH
    VIEW_EMPLOYEES: 'view_employees',
    MANAGE_EMPLOYEES: 'manage_employees', // ABM Empleados
    MANAGE_ABSENCES: 'manage_absences',   // Cargar licencias
    
    // Configuración
    VIEW_AUDIT: 'view_audit',            // Ver historial
    MANAGE_USERS: 'manage_users',        // Crear otros admins
    MANAGE_ROLES: 'manage_roles',        // (Futuro) Crear roles
} as const;

// 2. DEFINICIÓN DE ROLES (Agrupación de permisos)
export const ROLES_CONFIG = {
    'SuperAdmin': [ 'ALL' ], // Acceso total (Llave maestra)
    
    'Director': [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_AUDIT,
        PERMISSIONS.AUDIT_GPS,
        PERMISSIONS.VIEW_EMPLOYEES
    ],
    
    'RRHH': [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_EMPLOYEES,
        PERMISSIONS.MANAGE_EMPLOYEES,
        PERMISSIONS.MANAGE_ABSENCES
    ],
    
    'Scheduler': [ // Planificador
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.MANAGE_SHIFTS,
        PERMISSIONS.VIEW_EMPLOYEES
    ],

    // Agrega aquí los roles que quieras inventar
    'Auditor': [
        PERMISSIONS.VIEW_AUDIT,
        PERMISSIONS.AUDIT_GPS
    ]
};

