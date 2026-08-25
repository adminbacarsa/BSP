import type { Notification } from 'expo-notifications';

/** Tipos que un vigilador debe ver en la app (whitelist). */
export const EMPLOYEE_ALERT_TYPES = new Set([
  'CONVOCATORIA_EVENTO',
  'EVENTO_CONFIRMADO',
  'CRONOGRAMA_PUBLICADO',
  'TURNO_NUEVO',
  'TURNO_MODIFICADO',
  'TURNO_COMPLETADO',
  'TURNO_ELIMINADO',
  'TURNO_CAMBIO',
  'CAMBIO_CRONOGRAMA',
  'FRANCO',
  'FRANCO_ASIGNADO',
  'RFZ',
  'TURA',
  'RETENCION_AUTO',
  'RETENCION_DETECTADA',
  'LLEGADA_TARDE',
  'SWAP_REQUEST',
  'SYSTEM_TEST',
]);

/** Cambios de malla que requieren acuse de lectura del colaborador. */
export const ACK_REQUIRED_TYPES = new Set([
  'CRONOGRAMA_PUBLICADO',
  'TURNO_NUEVO',
  'TURNO_MODIFICADO',
  'TURNO_ELIMINADO',
  'TURNO_CAMBIO',
  'CAMBIO_CRONOGRAMA',
  'FRANCO_ASIGNADO',
  'FRANCO',
  'RFZ',
  'TURA',
  'CONVOCATORIA_EVENTO',
  'EVENTO_CONFIRMADO',
]);

const AGENDA_TYPES = new Set([
  'CRONOGRAMA_PUBLICADO',
  'TURNO_NUEVO',
  'TURNO_COMPLETADO',
  'TURNO_ELIMINADO',
  'TURNO_MODIFICADO',
  'TURNO_CAMBIO',
  'CAMBIO_CRONOGRAMA',
  'FRANCO',
  'FRANCO_ASIGNADO',
  'RFZ',
  'TURA',
]);

const HOY_TYPES = new Set(['RETENCION_AUTO', 'RETENCION_DETECTADA', 'LLEGADA_TARDE']);

const EVENTOS_TYPES = new Set(['CONVOCATORIA_EVENTO', 'EVENTO_CONFIRMADO']);

export function isEmployeeFacingAlert(raw: {
  type?: string;
  target?: string;
  dismissed?: boolean;
  status?: string;
}): boolean {
  if (raw.dismissed === true || raw.status === 'INACTIVE') return false;
  const target = String(raw.target || '')
    .trim()
    .toLowerCase();
  if (target === 'admin' || target === 'ops' || target === 'operaciones') return false;
  const type = String(raw.type || '')
    .trim()
    .toUpperCase();
  if (!type) return false;
  return EMPLOYEE_ALERT_TYPES.has(type);
}

export function requiresAck(type: string | undefined, ackedAt?: unknown): boolean {
  if (ackedAt) return false;
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  if (!ACK_REQUIRED_TYPES.has(t)) return false;
  return true;
}

/** Acuse pendiente: por tipo o por flag, siempre respetando ackedAt. */
export function alertNeedsAck(item: {
  type?: string;
  requiresAck?: boolean;
  ackedAt?: unknown;
}): boolean {
  if (item.ackedAt) return false;
  if (item.requiresAck === true) return true;
  return requiresAck(item.type, item.ackedAt);
}

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
  if (type.includes('NOVEDAD') || type.includes('AUSENCIA') || type.includes('LICENCIA')) {
    // Solo novedades propias del portal empleado — no alertas ops de ausencia de terceros
    if (EMPLOYEE_ALERT_TYPES.has(type) || type === 'NOVEDAD_PROPIA') {
      return '/novedad';
    }
  }

  const link = String(data.link ?? data.route ?? data.path ?? '').trim();
  if (link) {
    if (link.includes('/admin')) return null;
    if (link.includes('/eventos') || link.includes('convocatoria')) return '/eventos';
    if (link.includes('/permutas') || link.includes('swap')) return '/permutas';
    if (link.includes('/credencial')) return '/credencial';
    if (link.includes('/novedad') || link.includes('ausencia')) return '/novedad';
    if (link.includes('/agenda') || link.includes('cronograma')) return '/(tabs)/agenda';
    if (link.includes('/home') || link.includes('/empleado')) return '/(tabs)';
  }

  if (type && EMPLOYEE_ALERT_TYPES.has(type)) {
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
  return 'Sistema';
}
