/**
 * Canal Android `alertas_turno` (avisos de turno y convocatorias).
 *
 * Se crea en runtime con setNotificationChannelAsync al abrir la app.
 * Sonido: stream de alarma del sistema (USAGE_ALARM) + sonido default.
 * Un .wav propio va en el plugin expo-notifications (`sounds`) de app.config.ts
 * y se embebe en el binario: eso exige un build EAS nuevo, no alcanza un OTA.
 * iOS time-sensitive: el entitlement de app.config también exige build nativo;
 * el payload lo manda Plataforma (interruptionLevel time-sensitive).
 */
export const ALERTAS_TURNO_CHANNEL_ID = 'alertas_turno';

export const ALERTAS_TURNO_CHANNEL = {
  name: 'Alertas de turno',
  description: 'Avisos de turno y convocatorias. Suenan con la pantalla bloqueada.',
  importance: 'MAX' as const,
  vibrationPattern: [0, 500, 250, 500, 250, 800],
  lockscreenVisibility: 'PUBLIC' as const,
  sound: 'default' as const,
  enableVibrate: true,
  audioUsage: 'ALARM' as const,
};
