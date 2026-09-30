/**
 * Canal Android de avisos de turno (¿Venís?, convocatorias, retención, código de anexo).
 *
 * `alertas_turno` ya existe en teléfonos con el binario anterior y Android no deja
 * cambiarle el sonido. El sonido propio vive en `alertas_turno_v2`, que solo se crea
 * si el binario trae el wav (>= 1.2.0): un canal creado sin el recurso queda sin
 * sonido propio para siempre, así que un OTA sobre un binario viejo no lo crea.
 * El servidor elige el canal por `device_tokens.nativeVersion`.
 * iOS: el mismo wav va en el bundle; el payload usa interruption-level time-sensitive.
 */
export const ALERTAS_TURNO_CHANNEL_ID_LEGACY = 'alertas_turno';

export const ALERTAS_TURNO_CHANNEL_ID = 'alertas_turno_v2';

/** Primer binario con el wav embebido. */
export const ALERTAS_TURNO_V2_MIN_NATIVE_VERSION = '1.2.0';

/** Compara versiones `x.y.z`; lo que no parsea cuenta como 0. */
export function compareNativeVersion(a: unknown, b: unknown): number {
  const parse = (v: unknown) =>
    String(v ?? '')
      .trim()
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** true si el binario nativo trae el sonido y puede crear `alertas_turno_v2`. */
export function binaryHasAlertasTurnoSound(nativeAppVersion: string | null | undefined): boolean {
  const v = String(nativeAppVersion ?? '').trim();
  if (!v) return false;
  return compareNativeVersion(v, ALERTAS_TURNO_V2_MIN_NATIVE_VERSION) >= 0;
}

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
