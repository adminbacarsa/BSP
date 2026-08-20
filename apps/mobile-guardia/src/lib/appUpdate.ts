import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

export type AppUpdateResult = {
  status: 'disabled' | 'upToDate' | 'ready' | 'error';
  message: string;
  reloading?: boolean;
};

export function getAppVersionLabel(): string {
  const v = Constants.expoConfig?.version ?? '—';
  const channel = Updates.channel || null;
  return channel ? `v${v} · canal ${channel}` : `v${v}`;
}

/**
 * Busca update OTA (EAS Update). En __DEV__ o builds sin updates: disabled.
 * Si hay update y apply=true: descarga y reinicia con pantalla de carga (evita gris).
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
        message: 'Hay una actualización disponible. Tocá Buscar actualización para instalarla.',
      };
    }

    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync({
      reloadScreenOptions: {
        backgroundColor: '#f9f9ff',
        spinner: {
          color: '#4f46e5',
        },
      },
    });
    return {
      status: 'ready',
      message: 'Actualización aplicada. Reiniciando…',
      reloading: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo comprobar la actualización';
    return { status: 'error', message: msg };
  }
}
