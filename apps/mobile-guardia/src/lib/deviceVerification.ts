/**
 * Validación de dispositivo (portal guardia).
 * Motivos locales + códigos de error acordados con Plataforma.
 *
 * Códigos Plataforma (callables activación / requestGuardDeviceRegistration):
 * - DEVICE_OWNED_BY_OTHER
 * - RETIRED_DEVICE_NEEDS_EMAIL
 *
 * Motivos locales (device_tokens / gate cliente):
 * - never_activated — sin token o verified !== true
 * - other_device — deviceId en token distinto al local
 * - needs_rebind — token verified pero sin deviceId (no dejar pasar)
 */

export type DeviceBlockReason =
  | 'never_activated'
  | 'other_device'
  | 'needs_rebind'
  | 'DEVICE_OWNED_BY_OTHER'
  | 'RETIRED_DEVICE_NEEDS_EMAIL';

export type DeviceVerifyResult = {
  verified: boolean;
  reason?: DeviceBlockReason;
};

/** Mensajes UX oficiales (Mauro / Plataforma). */
export const DEVICE_BLOCK_MESSAGES: Record<DeviceBlockReason, string> = {
  never_activated:
    'Todavía no activaste tu cuenta. Usá el mail de acceso o pedile a RRHH que te lo reenvíe.',
  other_device:
    'Esta cuenta ya está activa en otro dispositivo. Cada legajo permite un dispositivo a la vez (Android o un navegador).',
  needs_rebind:
    'Validá este dispositivo con el mail de acceso o pedí aprobación a RRHH.',
  DEVICE_OWNED_BY_OTHER:
    'Este teléfono ya tiene otra cuenta validada. Cada teléfono se usa con un solo colaborador: entrá con esa cuenta, o pedile a RRHH que desvincule el teléfono.',
  RETIRED_DEVICE_NEEDS_EMAIL: 'Para volver a este dispositivo usá el mail de acceso.',
};

export const PLATFORM_DEVICE_ERROR_CODES = [
  'DEVICE_OWNED_BY_OTHER',
  'RETIRED_DEVICE_NEEDS_EMAIL',
] as const;

export type PlatformDeviceErrorCode = (typeof PLATFORM_DEVICE_ERROR_CODES)[number];

/** ¿La UI puede ofrecer «Registrar este dispositivo»? */
export function canRequestDeviceRegistration(reason: DeviceBlockReason | null | undefined): boolean {
  if (!reason) return false;
  if (reason === 'never_activated') return false;
  if (reason === 'needs_rebind') return true;
  if (reason === 'other_device') return true;
  if (reason === 'DEVICE_OWNED_BY_OTHER') return false;
  if (reason === 'RETIRED_DEVICE_NEEDS_EMAIL') return false;
  return false;
}

/**
 * Evalúa el doc `device_tokens/{uid}` vs el deviceId local.
 * Pure: sin I/O — apto para tests.
 */
export function evaluateDeviceTokenBinding(params: {
  tokenExists: boolean;
  verified?: boolean;
  boundDeviceId?: string | null;
  localDeviceId?: string | null;
}): DeviceVerifyResult {
  if (!params.tokenExists) {
    return { verified: false, reason: 'never_activated' };
  }
  if (params.verified !== true) {
    return { verified: false, reason: 'never_activated' };
  }
  const bound = String(params.boundDeviceId ?? '').trim();
  if (!bound) {
    return { verified: false, reason: 'needs_rebind' };
  }
  const local = String(params.localDeviceId ?? '').trim();
  if (!local || local !== bound) {
    return { verified: false, reason: 'other_device' };
  }
  return { verified: true };
}

function pickPlatformCode(raw: string | null | undefined): PlatformDeviceErrorCode | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'DEVICE_OWNED_BY_OTHER') return 'DEVICE_OWNED_BY_OTHER';
  if (upper === 'RETIRED_DEVICE_NEEDS_EMAIL') return 'RETIRED_DEVICE_NEEDS_EMAIL';
  return null;
}

/**
 * Extrae código Plataforma desde HttpsError Firebase (message / details / customData).
 */
export function extractPlatformDeviceErrorCode(err: unknown): PlatformDeviceErrorCode | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as {
    code?: string;
    message?: string;
    details?: unknown;
    customData?: unknown;
  };

  const fromMessage = pickPlatformCode(e.message);
  if (fromMessage) return fromMessage;

  const msg = String(e.message ?? '');
  for (const code of PLATFORM_DEVICE_ERROR_CODES) {
    if (msg.includes(code)) return code;
  }

  const details = e.details;
  if (typeof details === 'string') {
    const c = pickPlatformCode(details);
    if (c) return c;
  } else if (details && typeof details === 'object') {
    const d = details as { code?: string; errorCode?: string; reason?: string };
    const c =
      pickPlatformCode(d.code) || pickPlatformCode(d.errorCode) || pickPlatformCode(d.reason);
    if (c) return c;
  }

  const custom = e.customData;
  if (custom && typeof custom === 'object') {
    const d = custom as { code?: string; message?: string };
    const c = pickPlatformCode(d.code) || pickPlatformCode(d.message);
    if (c) return c;
  }

  return null;
}

export function mapPlatformDeviceErrorMessage(err: unknown): string | null {
  const code = extractPlatformDeviceErrorCode(err);
  if (!code) return null;
  return DEVICE_BLOCK_MESSAGES[code];
}

export function isPlatformDeviceError(err: unknown): boolean {
  return extractPlatformDeviceErrorCode(err) !== null;
}
