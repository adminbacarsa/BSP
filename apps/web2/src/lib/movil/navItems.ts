export type MovilModuleId = 'operacion' | 'supervision' | 'planificacion' | 'eventuales' | 'rrhh' | 'servicios';

export interface MovilModule {
  id: MovilModuleId;
  label: string;
  /** Qué hace en el celular, en una línea. */
  desc: string;
  href: string;
  /** Ruta base para saber si estamos parados en este módulo. */
  path: string;
  /** Tiene pantalla celular propia; si no, se muestra «Disponible en la computadora». */
  mobile: boolean;
}

export const MOVIL_MODULES: readonly MovilModule[] = [
  { id: 'operacion', label: 'Operación', desc: 'Centro de Control', href: '/admin/operaciones/', path: '/admin/operaciones', mobile: true },
  { id: 'supervision', label: 'Supervisión', desc: 'Solo lectura', href: '/admin/operaciones/?modo=supervision', path: '/admin/operaciones', mobile: true },
  { id: 'planificacion', label: 'Planificación', desc: 'Cronogramas', href: '/admin/planificacion/', path: '/admin/planificacion', mobile: false },
  { id: 'eventuales', label: 'Eventuales', desc: 'Bolsa y convocatorias', href: '/admin/rrhh/eventuales/', path: '/admin/rrhh/eventuales', mobile: false },
  { id: 'rrhh', label: 'RRHH', desc: 'Legajos y novedades', href: '/admin/rrhh/', path: '/admin/rrhh', mobile: false },
  { id: 'servicios', label: 'Servicios', desc: 'Contratos por objetivo', href: '/admin/servicios/', path: '/admin/servicios', mobile: true },
];

type CanRead = (moduleKey: string) => boolean;

function moduleAllowed(id: MovilModuleId, canRead: CanRead): boolean {
  switch (id) {
    case 'operacion': return canRead('OPERATIONS');
    case 'supervision': return canRead('SUPERVISION') || canRead('OPERATIONS');
    case 'planificacion': return canRead('PLANNING');
    case 'eventuales': return canRead('EVENTUALES') || canRead('RRHH');
    case 'rrhh': return canRead('RRHH');
    case 'servicios': return canRead('SERVICES') || canRead('CLIENTS');
    default: return false;
  }
}

/** Grilla del menú «Más» según permisos de lectura (isSuperAdmin ve todo si `canRead` lo contempla). */
export function movilModulesForPermissions(canRead: CanRead): MovilModule[] {
  return MOVIL_MODULES.filter((item) => moduleAllowed(item.id, canRead));
}

type Query = Record<string, string | string[] | undefined>;

function queryValue(query: Query | undefined, key: string): string {
  const raw = query?.[key];
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
}

/** Módulo en el que está parada la pantalla actual. */
export function movilModuleForPath(pathname: string, query?: Query): MovilModule | null {
  const path = String(pathname || '').replace(/\/$/, '');
  if (path.startsWith('/admin/operaciones')) {
    const id: MovilModuleId = queryValue(query, 'modo') === 'supervision' ? 'supervision' : 'operacion';
    return MOVIL_MODULES.find((item) => item.id === id) || null;
  }
  const ordered = [...MOVIL_MODULES].sort((a, b) => b.path.length - a.path.length);
  return ordered.find((item) => path === item.path || path.startsWith(`${item.path}/`)) || null;
}

/** Rutas /admin/* con pantalla celular propia. El resto muestra «Disponible en la computadora». */
export function movilRouteHasMobileVersion(pathname: string): boolean {
  const path = String(pathname || '').replace(/\/$/, '');
  if (path.startsWith('/admin/supervision')) return true;
  const mod = movilModuleForPath(path);
  return !!mod && mod.mobile;
}

export type MovilNavId = 'inicio' | 'alertas' | 'mas';

export interface MovilNavItem {
  id: MovilNavId;
  label: string;
  /** Vacío = botón sin navegación (Más abre el menú). */
  href: string;
}

/**
 * Barra inferior fija y corta: Inicio del módulo actual, Alertas (si opera) y Más.
 * Sin módulo actual, Inicio lleva al primer módulo permitido.
 */
export function movilNavForPermissions(canRead: CanRead, pathname = '/admin/operaciones', query?: Query): MovilNavItem[] {
  const modules = movilModulesForPermissions(canRead);
  const current = movilModuleForPath(pathname, query);
  const home = (current && modules.some((item) => item.id === current.id) ? current : modules[0]) || null;
  const items: MovilNavItem[] = [
    { id: 'inicio', label: 'Inicio', href: home?.href || '/admin/operaciones/' },
  ];
  if (canRead('OPERATIONS')) {
    items.push({ id: 'alertas', label: 'Alertas', href: '/admin/operaciones/?panel=alertas' });
  }
  items.push({ id: 'mas', label: 'Más', href: '' });
  return items;
}
