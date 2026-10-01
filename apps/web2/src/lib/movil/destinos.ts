export type MovilDestinoId = 'operacion' | 'supervision' | 'planificacion' | 'eventuales' | 'rrhh' | 'servicios';

export interface MovilDestino {
  id: MovilDestinoId;
  label: string;
  href: string;
  moduleKey: string;
}

/** Rutas que el menú Más (cursor/movil-shell) puede abrir. */
export const MOVIL_DESTINOS: MovilDestino[] = [
  { id: 'operacion', label: 'Operación', href: '/admin/operaciones/', moduleKey: 'OPERATIONS' },
  { id: 'supervision', label: 'Supervisión', href: '/admin/supervision/', moduleKey: 'SUPERVISION' },
  { id: 'planificacion', label: 'Planificación', href: '/admin/planificacion/', moduleKey: 'PLANNING' },
  { id: 'eventuales', label: 'Eventuales', href: '/admin/rrhh/eventuales/', moduleKey: 'EVENTUALES' },
  { id: 'rrhh', label: 'RRHH', href: '/admin/rrhh/movil/', moduleKey: 'RRHH' },
  { id: 'servicios', label: 'Servicios', href: '/admin/servicios/', moduleKey: 'SERVICES' },
];

export function movilDestinosVisibles(
  canRead: (moduleKey: string) => boolean,
  isSuperAdmin = false,
): MovilDestino[] {
  if (isSuperAdmin) return MOVIL_DESTINOS;
  return MOVIL_DESTINOS.filter((destino) => {
    if (destino.id === 'eventuales') return canRead('EVENTUALES') || canRead('RRHH');
    return canRead(destino.moduleKey);
  });
}
