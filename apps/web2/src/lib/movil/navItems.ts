export type MovilNavId = 'operaciones' | 'alertas' | 'plan' | 'eventuales' | 'novedades' | 'mas';

/** Rutas que el menú Más (cursor/movil-shell) puede abrir. Planificación es la pantalla básica, no la grilla. */
export const MOVIL_RUTA_PLANIFICACION = '/admin/movil/planificacion/';

export const MOVIL_RUTAS = {
  operacion: '/admin/operaciones/',
  supervision: '/admin/supervision/',
  planificacion: MOVIL_RUTA_PLANIFICACION,
  eventuales: '/admin/rrhh/eventuales/',
  rrhh: '/admin/rrhh/',
  servicios: '/admin/servicios/',
} as const;

export interface MovilNavItem {
  id: MovilNavId;
  label: string;
  href: string;
}

/** Barra inferior según permisos de lectura. Más siempre está. */
export function movilNavForPermissions(canRead: (moduleKey: string) => boolean): MovilNavItem[] {
  const items: MovilNavItem[] = [];
  if (canRead('OPERATIONS')) {
    items.push({ id: 'operaciones', label: 'Operaciones', href: '/admin/operaciones/' });
    items.push({ id: 'alertas', label: 'Alertas', href: '/admin/operaciones/?panel=alertas' });
  }
  if (canRead('EVENTUALES') || canRead('RRHH')) {
    items.push({ id: 'eventuales', label: 'Eventuales', href: '/admin/rrhh/eventuales/' });
  }
  if (canRead('RRHH') || canRead('OPERATIONS')) {
    items.push({ id: 'novedades', label: 'Novedades', href: '/admin/rrhh/' });
  }
  if (canRead('PLANNING')) {
    items.push({ id: 'plan', label: 'Plan', href: MOVIL_RUTA_PLANIFICACION });
  }
  items.push({ id: 'mas', label: 'Más', href: '/admin/operaciones/?panel=mas' });
  return items;
}
