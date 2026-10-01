export type MovilNavId = 'operaciones' | 'alertas' | 'eventuales' | 'novedades' | 'mas';

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
  if (canRead('PLANNING') && !canRead('OPERATIONS')) {
    items.push({ id: 'operaciones', label: 'Plan', href: '/admin/planificacion/' });
  }
  items.push({ id: 'mas', label: 'Más', href: '/admin/operaciones/?panel=mas' });
  return items;
}
