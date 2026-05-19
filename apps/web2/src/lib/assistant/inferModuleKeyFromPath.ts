/**
 * Deduce una clave de módulo COSP desde la ruta Next para el asistente (orientación UI).
 */

const ADMIN_PREFIXES: [string, string][] = [
  ['/admin/configuracion', 'CONFIG'],
  ['/admin/analisis', 'ANALYSIS'],
  ['/admin/reportes', 'REPORTS'],
  ['/admin/servicios', 'SERVICES'],
  ['/admin/crm', 'CLIENTS'],
  ['/admin/rrhh', 'RRHH'],
  ['/admin/planificacion', 'PLANNING'],
  ['/admin/operaciones', 'OPERATIONS'],
  ['/admin/dashboard', 'DASHBOARD'],
  ['/admin', 'DASHBOARD'],
];

export function inferModuleKeyFromPath(pathname: string): string | null {
  const p = (pathname || '').split('?')[0] || '/';
  if (p.startsWith('/empleado')) return 'EMPLOYEE_PORTAL';
  if (p.startsWith('/cliente')) return 'CLIENT_PORTAL';

  for (const [prefix, key] of ADMIN_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return key;
  }
  if (p.startsWith('/admin')) return 'DASHBOARD';
  return null;
}

/** Etiqueta corta para el encabezado del asistente (es-AR). */
const MODULE_TITLE_ES: Record<string, string> = {
  DASHBOARD: 'Panel principal',
  OPERATIONS: 'Operaciones',
  PLANNING: 'Planificación',
  RRHH: 'RRHH',
  CLIENTS: 'Clientes',
  SERVICES: 'Servicios',
  REPORTS: 'Reportes',
  ANALYSIS: 'Análisis',
  CONFIG: 'Configuración',
  EMPLOYEE_PORTAL: 'Portal empleado',
  CLIENT_PORTAL: 'Portal cliente',
};

export function moduleTitleEs(moduleKey: string | null): string {
  if (!moduleKey) return 'General';
  return MODULE_TITLE_ES[moduleKey] ?? moduleKey.replace(/_/g, ' ');
}
