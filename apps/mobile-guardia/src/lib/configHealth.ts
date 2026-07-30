import Constants from 'expo-constants';

export type ConfigHealth = {
  configured: boolean;
  missing: string[];
  emulator: boolean;
  projectId: string;
};

type ExpoExtra = {
  useEmulator?: boolean;
  emulatorHost?: string;
  firebase?: Record<string, string | undefined>;
};

function getExtra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

/** Smoke test: solo lee .env vía app.config — sin importar Firebase (evita crash Hermes). */
export function getConfigHealth(): ConfigHealth {
  const extra = getExtra();
  const firebase = extra.firebase ?? {};
  const required = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ] as const;

  const missing = required.filter((key) => !firebase[key]?.trim());

  return {
    configured: missing.length === 0,
    missing: [...missing],
    emulator: extra.useEmulator === true,
    projectId: firebase.projectId?.trim() || '(sin projectId)',
  };
}
