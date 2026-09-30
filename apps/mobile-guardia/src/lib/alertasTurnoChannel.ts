/**
 * Canal Android de avisos de turno (¿Venís?, convocatorias, retención, código de anexo).
 *
 * `alertas_turno` ya existe en teléfonos con el binario anterior y Android no deja
 * cambiarle el sonido. El sonido propio vive en `alertas_turno_v2` (este binario).
 * El canal viejo se sigue creando con el sonido default para mensajes que todavía
 * lleguen con ese id. El .wav lo embebe el plugin expo-notifications: hace falta
 * un build EAS, no alcanza un OTA.
 * iOS: el mismo wav va en el bundle; el payload usa interruption-level time-sensitive.
 */
export const ALERTAS_TURNO_CHANNEL_ID_LEGACY = 'alertas_turno';

export const ALERTAS_TURNO_CHANNEL_ID = 'alertas_turno_v2';

/** Nombre del raw Android (sin extensión). En iOS el archivo lleva .wav. */
export const ALERTAS_TURNO_SOUND = 'alertas_turno';

export const ALERTAS_TURNO_SOUND_IOS = 'alertas_turno.wav';

export const ALERTAS_TURNO_CHANNEL = {
  name: 'Alertas de turno',
  description: 'Avisos de turno y convocatorias. Suenan con la pantalla bloqueada.',
  importance: 'MAX' as const,
  vibrationPattern: [0, 500, 250, 500, 250, 800],
  lockscreenVisibility: 'PUBLIC' as const,
  sound: ALERTAS_TURNO_SOUND,
  enableVibrate: true,
  audioUsage: 'ALARM' as const,
};

export const ALERTAS_TURNO_CHANNEL_LEGACY = {
  name: 'Avisos de turno',
  description: 'Canal anterior. Los avisos nuevos usan Alertas de turno.',
  importance: 'MAX' as const,
  sound: 'default' as const,
};
