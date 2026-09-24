import { httpsCallable } from 'firebase/functions';
import { getDeviceInfo } from './deviceInfo';
import { getMobilePlatform, getOrCreateDeviceId, type MobilePlatform } from './deviceId';
import { getPortalFirebase } from './portal';
import { mapPortalCallableError } from './mapPortalCallableError';

export type GuardDeviceRegistrationStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'unknown';

export type GuardDeviceRegistrationStatusResult = {
  status: GuardDeviceRegistrationStatus;
  requestId?: string | null;
  deviceId?: string | null;
  message?: string | null;
};

type RequestCallableResponse = {
  success?: boolean;
  requestId?: string;
  status?: string;
  message?: string;
  deviceId?: string;
};

type StatusCallableResponse = {
  status?: string;
  requestId?: string | null;
  deviceId?: string | null;
  message?: string | null;
  verified?: boolean;
};

function normalizeStatus(raw: unknown): GuardDeviceRegistrationStatus {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s || s === 'none' || s === 'idle' || s === 'absent') return 'none';
  if (s === 'pending' || s === 'requested' || s === 'waiting') return 'pending';
  if (s === 'approved' || s === 'accepted' || s === 'verified' || s === 'ok') return 'approved';
  if (s === 'rejected' || s === 'denied' || s === 'cancelled') return 'rejected';
  return 'unknown';
}

/**
 * Estado de una solicitud de re-vinculación (Plataforma).
 * Callable: getGuardDeviceRegistrationStatus
 */
export async function getGuardDeviceRegistrationStatus(): Promise<
  { ok: true } & GuardDeviceRegistrationStatusResult | { ok: false; message: string }
> {
  try {
    const { functions } = getPortalFirebase();
    const callable = httpsCallable<Record<string, never>, StatusCallableResponse>(
      functions,
      'getGuardDeviceRegistrationStatus',
    );
    const { data } = await callable({});
    return {
      ok: true,
      status: normalizeStatus(data?.status),
      requestId: data?.requestId ?? null,
      deviceId: data?.deviceId ?? null,
      message: data?.message ?? null,
    };
  } catch (err) {
    return { ok: false, message: mapPortalCallableError(err) };
  }
}

/**
 * Solicitud de re-vinculación cuando se pierde el deviceId (p. ej. Safari 7 días)
 * o el legajo está atado a otro dispositivo.
 *
 * Callable Plataforma: requestGuardDeviceRegistration (no escribe directo en Firestore).
 */
export async function requestDeviceRegistration(_params?: {
  empDocId?: string | null;
  empresaId?: string | null;
  displayName?: string | null;
}): Promise<
  | { ok: true; requestId?: string; deviceId: string; status: GuardDeviceRegistrationStatus }
  | { ok: false; message: string }
> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const platform: MobilePlatform = getMobilePlatform();
    const deviceInfo = getDeviceInfo();

    const { functions } = getPortalFirebase();
    const callable = httpsCallable<
      {
        deviceId: string;
        deviceInfo: Record<string, string>;
        platform: MobilePlatform;
      },
      RequestCallableResponse
    >(functions, 'requestGuardDeviceRegistration');

    const { data } = await callable({
      deviceId,
      deviceInfo,
      platform,
    });

    if (data?.success === false) {
      return {
        ok: false,
        message: data.message || 'No se pudo enviar la solicitud de registro.',
      };
    }

    return {
      ok: true,
      requestId: data?.requestId,
      deviceId: data?.deviceId || deviceId,
      status: normalizeStatus(data?.status || 'pending'),
    };
  } catch (err) {
    return { ok: false, message: mapPortalCallableError(err) };
  }
}
