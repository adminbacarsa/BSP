import type * as admin from 'firebase-admin';

/**
 * Avisos de turno: llegada, ¿Venís?, cobertura.
 * Android: la app crea el canal `alertas_turno` (alta importancia, sonido).
 */
export const SHIFT_ALERT_CHANNEL_ID = 'alertas_turno';

export const SHIFT_ALERT_FCM_TYPES = new Set([
  'CONVOCATORIA_COBERTURA',
  'AVISO_TURNO_PROXIMO',
  'AVISO_ENTRANTE_SIN_FICHAR',
  'RETENCION_AVISO',
  'SOLICITUD_ESTADO_LLEGADA',
  'SOLICITUD_ESTADO_RELEVO',
  'CONVOCADO_RECORDATORIO',
]);

export function isShiftAlertFcmType(type: string): boolean {
  return SHIFT_ALERT_FCM_TYPES.has(String(type || '').trim().toUpperCase());
}

export function shiftAlertPlatformConfig(): {
  android: admin.messaging.AndroidConfig;
  apns: admin.messaging.ApnsConfig;
} {
  return {
    android: {
      priority: 'high',
      notification: {
        channelId: SHIFT_ALERT_CHANNEL_ID,
        sound: 'default',
        priority: 'high',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      payload: {
        aps: {
          sound: 'default',
          'interruption-level': 'time-sensitive',
        },
      },
    },
  };
}
