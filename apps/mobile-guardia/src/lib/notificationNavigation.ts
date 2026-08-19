import type { Notification } from 'expo-notifications';

export function routeFromNotificationData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const type = String(data.type ?? data.tipo ?? '')
    .trim()
    .toUpperCase();

  if (type === 'CONVOCATORIA_EVENTO' || type === 'EVENTO_CONFIRMADO') {
    return '/eventos';
  }
  if (type === 'SWAP_REQUEST') {
    return '/permutas';
  }

  const link = String(data.link ?? data.route ?? data.path ?? '').trim();
  if (!link) return null;

  if (link.includes('/eventos') || link.includes('convocatoria')) return '/eventos';
  if (link.includes('/permutas') || link.includes('swap')) return '/permutas';
  if (link.includes('/credencial')) return '/credencial';
  if (link.includes('/novedad') || link.includes('ausencia')) return '/novedad';
  if (link.includes('/agenda') || link.includes('cronograma')) return '/agenda';

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
