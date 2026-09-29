import Constants from 'expo-constants';
import { getPortalCallables } from './portal';
import { getMobilePlatform, getOrCreateDeviceId } from './deviceId';
import { mapPortalCallableError } from './mapPortalCallableError';
import { classifyCoberturaRespondError } from './coberturaRespondError';

export type CoberturaResponseChannel = 'ALERTAS' | 'BANNER_HOY' | 'PUSH_ACTION';

export type RespondCoberturaResult =
  | { ok: true; message: string }
  | { ok: false; message: string; dismissInbox: boolean };

/**
 * Misma callable que el banner de Hoy. El servidor guarda canal, device y versión en la convocatoria.
 */
export async function respondCoberturaConvocatoria(params: {
  convocatoriaId: string;
  response: 'ACCEPTED' | 'REJECTED';
  responseChannel: CoberturaResponseChannel;
  rejectionReason?: string;
  etaMinutes?: number;
}): Promise<RespondCoberturaResult> {
  const convocatoriaId = String(params.convocatoriaId || '').trim();
  if (!convocatoriaId) {
    return {
      ok: false,
      message: 'Falta el id de la convocatoria. Abrí Hoy y respondé desde el banner.',
      dismissInbox: false,
    };
  }

  const deviceId = await getOrCreateDeviceId().catch(() => undefined);
  const platform = getMobilePlatform();

  try {
    const { responderConvocatoriaCobertura } = getPortalCallables();
    await responderConvocatoriaCobertura({
      convocatoriaId,
      response: params.response,
      rejectionReason: params.rejectionReason,
      etaMinutes: params.etaMinutes,
      responseChannel: params.responseChannel,
      deviceId: deviceId || undefined,
      platform,
      appVersion: Constants.expoConfig?.version || undefined,
    });
    return {
      ok: true,
      message:
        params.response === 'ACCEPTED' ? 'Convocatoria aceptada' : 'Convocatoria rechazada',
    };
  } catch (e) {
    const classified = classifyCoberturaRespondError(e);
    if (classified.kind === 'stale') {
      return { ok: false, message: classified.message, dismissInbox: true };
    }
    return {
      ok: false,
      message: classified.message || mapPortalCallableError(e),
      dismissInbox: false,
    };
  }
}
