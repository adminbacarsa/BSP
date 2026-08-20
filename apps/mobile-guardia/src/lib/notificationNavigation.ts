import type { Notification } from 'expo-notifications';

const AGENDA_TYPES = new Set([
  'CRONOGRAMA_PUBLICADO',
  'TURNO_NUEVO',
  'TURNO_COMPLETADO',
  'TURNO_ELIMINADO',
  'TURNO_CAMBIO',
  'CAMBIO_CRONOGRAMA',
  'FRANCO',
  'RFZ',
  'TURA',
]);

const HOY_TYPES = new Set(['RETENCION_AUTO', 'RETENCION_DETECTADA', 'LLEGADA_TARDE']);

const EVENTOS_TYPES = new Set(['CONVOCATORIA_EVENTO', 'EVENTO_CONFIRMADO', 'VACANTE_POR_EVENTO']);

/**
 * Deep links nativos (tabs + pantallas stack).
 * data.type / data.tipo del FCM o de user_notifications.
 */
export function routeFromNotificationData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const type = String(data.type ?? data.tipo ?? '')
    .trim()
    .toUpperCase();

  if (EVENTOS_TYPES.has(type)) {
    return '/eventos';
  }
  if (type === 'SWAP_REQUEST') {
    return '/permutas';
  }
  if (HOY_TYPES.has(type)) {
    return '/(tabs)';
  }
  if (AGENDA_TYPES.has(type)) {
    return '/(tabs)/agenda';
  }
  if (type === 'NOVEDAD' || type.includes('AUSENCIA') || type.includes('LICENCIA')) {
    return '/novedad';
  }

  const link = String(data.link ?? data.route ?? data.path ?? '').trim();
  if (link) {
    if (link.includes('/eventos') || link.includes('convocatoria')) return '/eventos';
    if (link.includes('/permutas') || link.includes('swap')) return '/permutas';
    if (link.includes('/credencial')) return '/credencial';
    if (link.includes('/novedad') || link.includes('ausencia')) return '/novedad';
    if (link.includes('/agenda') || link.includes('cronograma')) return '/(tabs)/agenda';
    if (link.includes('/home') || link.includes('/empleado')) return '/(tabs)';
  }

  if (type) {
    return '/(tabs)/alertas';
  }

  return null;
}

export function extractNotificationData(notification: Notification): Record<string, unknown> {
  const raw = notification.request.content.data;
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function routeFromNotification(notification: Notification): string | null {
  return routeFromNotificationData(extractNotificationData(notification));
}

export function notificationActionLabel(type: string | undefined): string {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  if (EVENTOS_TYPES.has(t)) return 'Ver convocatoria';
  if (t === 'SWAP_REQUEST') return 'Ver permutas';
  if (AGENDA_TYPES.has(t)) return 'Ver agenda';
  if (HOY_TYPES.has(t)) return 'Ir a Hoy';
  if (t.includes('NOVEDAD') || t.includes('AUSENCIA') || t.includes('LICENCIA')) return 'Ver novedad';
  return 'Abrir';
}

export function notificationDomainLabel(type: string | undefined): string {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  if (EVENTOS_TYPES.has(t)) return 'Eventos';
  if (t === 'SWAP_REQUEST') return 'Permutas';
  if (AGENDA_TYPES.has(t)) return 'Planificación';
  if (HOY_TYPES.has(t)) return 'Operaciones';
  if (t.includes('NOVEDAD') || t.includes('AUSENCIA') || t.includes('LICENCIA')) return 'RRHH';
  return 'Sistema';
}
