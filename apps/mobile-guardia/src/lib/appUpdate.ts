import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

export type AppUpdateResult = {
  status: 'disabled' | 'upToDate' | 'ready' | 'downloaded' | 'error';
  message: string;
  reloading?: boolean;
};

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function getAppUpdateDiagnostics(): string {
  const v = Constants.expoConfig?.version ?? '—';
  const channel = Updates.channel || '(sin canal)';
  const runtime = Updates.runtimeVersion || Constants.expoConfig?.runtimeVersion || '—';
  const updateId = shortId(Updates.updateId);
  const embedded = Updates.isEmbeddedLaunch ? 'embebida' : 'OTA';
  return `v${v} · canal ${channel} · runtime ${runtime} · ${embedded} · id ${updateId}`;
}

export function getAppVersionLabel(): string {
  return getAppUpdateDiagnostics();
}

/**
 * Busca / descarga OTA. NO llama a reloadAsync (en varios Android queda pantalla gris).
 * Tras descargar, el usuario debe cerrar la app por completo y volver a abrirla.
 */
export async function checkAndApplyAppUpdate(opts?: {
  apply?: boolean;
}): Promise<AppUpdateResult> {
  const apply = opts?.apply !== false;
  const diag = getAppUpdateDiagnostics();

  if (__DEV__) {
    return {
      status: 'disabled',
      message: 'En desarrollo (Expo Go / metro) no hay OTA. Usá la APK preview de EAS.',
    };
  }

  if (!Updates.isEnabled) {
    return {
      status: 'disabled',
      message:
        'Esta instalación no admite OTA. Desinstalá y volvé a instalar la APK preview (eas build --profile preview).',
    };
  }

  const channel = String(Updates.channel || '').trim().toLowerCase();
  if (channel && channel !== 'preview' && channel !== 'production') {
    // canal raro: igual intentamos
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      const canalHint =
        channel === 'preview'
          ? 'Canal preview OK.'
          : channel === 'production'
            ? 'Estás en canal PRODUCTION: no vas a recibir OTAs de preview.'
            : 'Sin canal detectado: esta APK puede no estar atada a EAS Update.';
      return {
        status: 'upToDate',
        message:
          `Expo no encuentra un OTA más nuevo.\n\n${diag}\n\n${canalHint}\n\n` +
          'Si acabás de publicar un OTA y seguís viendo la UI vieja: cerrá COSP Guardia por completo (quitar de recientes) y abrila de nuevo. El botón no reinicia solo.',
      };
    }

    if (!apply) {
      return {
        status: 'ready',
        message: `Hay una actualización disponible.\n\n${diag}`,
      };
    }

    await Updates.fetchUpdateAsync();
    return {
      status: 'downloaded',
      message:
        'Actualización descargada.\n\nCerrá COSP Guardia por completo (quitar de recientes) y volvé a abrirla.\nNo uses «Descargar» otra vez hasta reiniciar.\n\n' +
        diag,
      reloading: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo comprobar la actualización';
    return { status: 'error', message: `${msg}\n\n${diag}` };
  }
}
