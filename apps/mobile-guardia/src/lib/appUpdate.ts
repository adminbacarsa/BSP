import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

export type AppUpdateResult = {
  status: 'disabled' | 'upToDate' | 'ready' | 'downloaded' | 'error';
  message: string;
  reloading?: boolean;
};

export function getAppVersionLabel(): string {
  const v = Constants.expoConfig?.version ?? '—';
  const channel = Updates.channel || null;
  return channel ? `v${v} · canal ${channel}` : `v${v}`;
}

/**
 * Busca / descarga OTA. NO llama a reloadAsync (en varios Android queda pantalla gris).
 * Tras descargar, el usuario debe cerrar la app por completo y volver a abrirla.
 */
export async function checkAndApplyAppUpdate(opts?: {
  apply?: boolean;
}): Promise<AppUpdateResult> {
  const apply = opts?.apply !== false;

  if (__DEV__) {
    return {
      status: 'disabled',
      message: 'En desarrollo no hay OTA. Usá un build EAS preview/production.',
    };
  }

  if (!Updates.isEnabled) {
    return {
      status: 'disabled',
      message:
        'Esta instalación no admite actualización in-app. Instalá la APK preview nueva (con EAS Update).',
    };
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return {
        status: 'upToDate',
        message: `Ya estás al día (${getAppVersionLabel()}).`,
      };
    }

    if (!apply) {
      return {
        status: 'ready',
        message: 'Hay una actualización disponible. Tocá Buscar actualización para descargarla.',
      };
    }

    await Updates.fetchUpdateAsync();
    return {
      status: 'downloaded',
      message:
        'Actualización descargada. Cerrá COSP Guardia por completo (quitar de recientes) y volvé a abrirla. No uses «Actualizar» otra vez.',
      reloading: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo comprobar la actualización';
    return { status: 'error', message: msg };
  }
}
