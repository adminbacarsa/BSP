import type * as admin from 'firebase-admin';

/**
 * Avisos de turno: llegada, ¿Venís?, cobertura, retención, código de anexo.
 * `alertas_turno_v2` (wav propio) solo existe en binarios >= 1.2.0. A un teléfono
 * con binario anterior se le manda `alertas_turno`: si recibe un canal que no tiene,
 * Android lo muestra en el default y pierde importancia y sonido.
 */
export const SHIFT_ALERT_CHANNEL_ID_LEGACY = 'alertas_turno';

export const SHIFT_ALERT_CHANNEL_ID = 'alertas_turno_v2';

/** Primer binario que trae el wav y crea `alertas_turno_v2`. */
export const SHIFT_ALERT_V2_MIN_NATIVE_VERSION = '1.2.0';

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
  'TURNO_FINALIZADO',
  'TOPE_JORNADA',
]);

export function isShiftAlertFcmType(type: string): boolean {
  return SHIFT_ALERT_FCM_TYPES.has(String(type || '').trim().toUpperCase());
}

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

/**
 * Canal según el binario que registró el token (`device_tokens.nativeVersion`).
 * Sin versión (tokens de binarios viejos o web) → canal legado.
 */
export function shiftAlertChannelForDevice(device: Record<string, unknown> | null | undefined): string {
  const version = String(device?.nativeVersion ?? '').trim();
  if (!version) return SHIFT_ALERT_CHANNEL_ID_LEGACY;
  return compareNativeVersion(version, SHIFT_ALERT_V2_MIN_NATIVE_VERSION) >= 0
    ? SHIFT_ALERT_CHANNEL_ID
    : SHIFT_ALERT_CHANNEL_ID_LEGACY;
}

export function shiftAlertPlatformConfig(channelId: string = SHIFT_ALERT_CHANNEL_ID_LEGACY): {
  android: admin.messaging.AndroidConfig;
  apns: admin.messaging.ApnsConfig;
} {
  const v2 = channelId === SHIFT_ALERT_CHANNEL_ID;
  return {
    android: {
      priority: 'high',
      notification: {
        channelId: v2 ? SHIFT_ALERT_CHANNEL_ID : SHIFT_ALERT_CHANNEL_ID_LEGACY,
        sound: v2 ? SHIFT_ALERT_SOUND : 'default',
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
          sound: v2 ? SHIFT_ALERT_SOUND_IOS : 'default',
          'interruption-level': 'time-sensitive',
        },
      },
    },
  };
}

export type DeviceTokenRow = { token: string; data: Record<string, unknown> };

/** Agrupa los tokens por canal para mandar un multicast por grupo. */
export function groupTokensByShiftAlertChannel(rows: DeviceTokenRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const token = String(row.token || '');
    if (token.length <= 10 || seen.has(token)) continue;
    seen.add(token);
    const channel = shiftAlertChannelForDevice(row.data);
    const list = out.get(channel) ?? [];
    list.push(token);
    out.set(channel, list);
  }
  return out;
}
