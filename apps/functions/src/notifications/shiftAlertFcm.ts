import type * as admin from 'firebase-admin';

/**
 * Avisos de turno: llegada, ¿Venís?, cobertura, retención, código de anexo.
 * Android: el binario nuevo crea `alertas_turno_v2` con el wav embebido.
 * El canal `alertas_turno` no se puede re-sonorizar. Si el teléfono todavía
 * no tiene v2, FCM muestra el aviso en el canal default del manifest.
 */
export const SHIFT_ALERT_CHANNEL_ID_LEGACY = 'alertas_turno';

export const SHIFT_ALERT_CHANNEL_ID = 'alertas_turno_v2';

/** Recurso res/raw (sin extensión). iOS usa el archivo con extensión. */
export const SHIFT_ALERT_SOUND = 'alertas_turno';

export const SHIFT_ALERT_SOUND_IOS = 'alertas_turno.wav';

export const SHIFT_ALERT_FCM_TYPES = new Set([
  'CONVOCATORIA_COBERTURA',
  'AVISO_TURNO_PROXIMO',
  'AVISO_ENTRANTE_SIN_FICHAR',
  'RETENCION_AVISO',
  'SOLICITUD_ESTADO_LLEGADA',
  'SOLICITUD_ESTADO_RELEVO',
  'CONVOCADO_RECORDATORIO',
  'CODIGO_ANEXO',
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
        sound: SHIFT_ALERT_SOUND,
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
          sound: SHIFT_ALERT_SOUND_IOS,
          'interruption-level': 'time-sensitive',
        },
      },
    },
  };
}
