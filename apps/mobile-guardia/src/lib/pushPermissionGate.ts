/**
 * Gate de notificaciones obligatorias (nativo).
 * Sin permiso/canal usable la app no recibe convocatorias ni avisos de turno.
 * Puro — sin Firebase / expo — para testearlo en Node.
 */

export type PushEstado = 'activo' | 'denegado' | 'sin_token';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | string;

/** Acción al tocar «Activar ahora». */
export type PushActivateAction = 'request' | 'open_settings' | 'none';

/** Motivo por el que se muestra el banner fijo. */
export type PushGateReason = 'permission' | 'channel' | null;

/** Importancia Android (mismo enum que expo-notifications AndroidImportance). */
export const ANDROID_IMPORTANCE = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
} as const;

export type PushPermissionSnapshot = {
  status: PushPermissionStatus;
  canAskAgain: boolean;
};

export type AlertasChannelSnapshot = {
  /** Canal inexistente o aún no creado. */
  missing: boolean;
  /** Importancia numérica; null si missing. */
  importance: number | null;
};

/**
 * ¿El canal de alertas está bloqueado o con importancia baja?
 * NONE = usuario apagó el canal. MIN/LOW = no suena / casi no se ve.
 */
export function isAlertasChannelBlocked(channel: AlertasChannelSnapshot | null | undefined): boolean {
  if (!channel || channel.missing) return false;
  const imp = channel.importance;
  if (imp == null || !Number.isFinite(imp)) return false;
  return imp <= ANDROID_IMPORTANCE.LOW;
}

/**
 * Qué hacer al tocar «Activar ahora».
 * - undetermined o canAskAgain → diálogo del sistema
 * - denegado sin poder pedir de nuevo → Ajustes
 * - permiso OK pero canal bloqueado → Ajustes (del canal si se puede)
 */
export function decidePushActivateAction(input: {
  permission: PushPermissionSnapshot;
  channelBlocked?: boolean;
}): PushActivateAction {
  const status = String(input.permission.status || '')
    .trim()
    .toLowerCase();
  if (status !== 'granted') {
    if (status === 'undetermined' || input.permission.canAskAgain === true) {
      return 'request';
    }
    return 'open_settings';
  }
  if (input.channelBlocked) return 'open_settings';
  return 'none';
}

/**
 * Estado que ve la plataforma (legajo / device_tokens).
 * - activo: permiso + token (y canal OK si aplica)
 * - denegado: permiso negado o canal bloqueado
 * - sin_token: permiso OK pero todavía no hay token FCM
 */
export function resolvePushEstado(input: {
  permissionGranted: boolean;
  hasToken: boolean;
  channelBlocked?: boolean;
}): PushEstado {
  if (!input.permissionGranted || input.channelBlocked) return 'denegado';
  if (!input.hasToken) return 'sin_token';
  return 'activo';
}

/** ¿Mostrar el banner fijo no descartable? Solo nativo; web sigue con su botón. */
export function shouldShowPushRequiredBanner(input: {
  platform: 'ios' | 'android' | 'web' | string;
  permissionGranted: boolean;
  channelBlocked?: boolean;
  /** Emulador / sin soporte: no insistir. */
  unsupported?: boolean;
}): boolean {
  if (input.unsupported) return false;
  const p = String(input.platform || '').toLowerCase();
  if (p === 'web') return false;
  if (!input.permissionGranted) return true;
  if (input.channelBlocked) return true;
  return false;
}

export function pushGateReason(input: {
  permissionGranted: boolean;
  channelBlocked?: boolean;
}): PushGateReason {
  if (!input.permissionGranted) return 'permission';
  if (input.channelBlocked) return 'channel';
  return null;
}

export const PUSH_REQUIRED_TITLE = 'Activá las notificaciones';
export const PUSH_REQUIRED_BODY =
  'Sin ellas no te llegan convocatorias ni avisos del turno.';
export const PUSH_REQUIRED_BUTTON = 'Activar ahora';
export const PUSH_REQUIRED_CHANNEL_BODY =
  'El canal de alertas de turno está apagado o en silencio. Activálo en Ajustes.';
