/** Rutas admin por módulo (SYSTEM_MODULES) para redirect post-login / sin permiso. */

export const MODULE_HOME_PATH: Record<string, string> = {
  DASHBOARD: '/admin/dashboard',
  OPERATIONS: '/admin/operaciones',
  PLANNING: '/admin/planificacion',
  RRHH: '/admin/rrhh',
  EVENTUALES: '/admin/rrhh/eventuales',
  CLIENTS: '/admin/crm',
  SERVICES: '/admin/servicios',
  REPORTS: '/admin/reportes',
  ANALYSIS: '/admin/analisis',
  HOURS_BANK: '/admin/banco-horas',
  SUPERVISION: '/admin/supervision',
  CONFIG: '/admin/configuracion',
};

const MODULE_PATH_PREFIX: { module: string; prefix: string }[] = [
  { module: 'DASHBOARD', prefix: '/admin/dashboard' },
  { module: 'OPERATIONS', prefix: '/admin/operaciones' },
  { module: 'PLANNING', prefix: '/admin/planificacion' },
  { module: 'RRHH', prefix: '/admin/rrhh' },
  { module: 'CLIENTS', prefix: '/admin/crm' },
  { module: 'SERVICES', prefix: '/admin/servicios' },
  { module: 'REPORTS', prefix: '/admin/reportes' },
  { module: 'ANALYSIS', prefix: '/admin/analisis' },
  { module: 'HOURS_BANK', prefix: '/admin/banco-horas' },
  { module: 'SUPERVISION', prefix: '/admin/supervision' },
  { module: 'CONFIG', prefix: '/admin/configuracion' },
  { module: 'EVENTUALES', prefix: '/admin/rrhh/eventuales' },
];

export function moduleHasRead(permissions: Record<string, string[]>, moduleKey: string): boolean {
  const actions = permissions[moduleKey];
  return Array.isArray(actions) && actions.includes('read');
}

/** Primer módulo con VER, en orden de menú operativo. */
export function firstAllowedAdminPath(permissions: Record<string, string[]>): string | null {
  const order = [
    'OPERATIONS',
    'PLANNING',
    'RRHH',
    'CLIENTS',
    'SERVICES',
    'REPORTS',
    'ANALYSIS',
    'SUPERVISION',
    'EVENTUALES',
    'HOURS_BANK',
    'DASHBOARD',
    'CONFIG',
  ];
  for (const key of order) {
    if (moduleHasRead(permissions, key) && MODULE_HOME_PATH[key]) return MODULE_HOME_PATH[key];
  }
  return null;
}

export function moduleKeyForAdminPath(pathname: string): string | null {
  const path = String(pathname || '');
  // Más específico primero (eventuales antes que rrhh).
  const sorted = [...MODULE_PATH_PREFIX].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { module, prefix } of sorted) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return module;
  }
  return null;
}
