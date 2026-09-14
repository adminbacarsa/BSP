/** Etiquetas legibles para acciones del log de auditoría de planificación. */
export const PLANIFICACION_ACTION_LABELS: Record<string, string> = {
    'ASIGNACION': 'Asignación',
    'ELIMINACION': 'Eliminación',
    'EDICION_MASIVA': 'Edición Masiva',
    'ASIGNACION_MASIVA': 'Asignación Múltiple',
    'CAMBIO_FRANCO_TURNO': 'Franco x Turno (FT)',
    'CAMBIO_TURNO_FRANCO': 'Turno x Franco (FF)',
    'Devolución a Planificación': 'Devolución desde Operaciones',
    'PUBLICACION_CRONOGRAMA': 'Publicación de cronograma',
    'DESPUBLICACION_CRONOGRAMA': 'Despublicación de cronograma',
    'CORRECCION_SUPERADMIN': 'Corrección (SuperAdmin)',
    'CORRECCION_PLANIFICACION': 'Corrección planificación',
    'CORRECCION_CODIGO': 'Corrección de código',
    'ELIMINACION_MASIVA': 'Eliminación masiva',
    'CAMBIO_DIAGRAMA': 'Cambio de diagrama',
    'TRANSFERENCIA_OBJETIVO': 'Transferencia de objetivo',
    'DESVINCULACION_OBJETIVO': 'Desvinculación de objetivo',
    'OVERRIDE_200H': 'Autorización >200h',
    'AUTORIZACION_FRANCO_COBERTURA': 'Autorización franco trabajado (cobertura)',
    'EQUILIBRAR_CRONOGRAMA': 'Equilibrar cronograma',
};

export function planificacionActionLabel(action: string | null | undefined, fallback = 'CAMBIO'): string {
    if (!action) return fallback;
    return PLANIFICACION_ACTION_LABELS[action] || action;
}
