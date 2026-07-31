import { Platform } from 'react-native';
import Constants from 'expo-constants';

type ExpoExtra = {
  emulatorHost?: string;
  useEmulator?: boolean;
};

function readEnvHost(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
  const fromExtra = extra.emulatorHost?.trim();
  if (fromExtra) return fromExtra;
  return process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST?.trim() || '127.0.0.1';
}

/**
 * Web en la misma PC que los emuladores: 127.0.0.1 (la IP Wi‑Fi a veces cuelga Firestore en Windows).
 * Celular físico: IP LAN de la notebook en .env.
 */
export function resolveEmulatorHostForPlatform(): string {
  const configured = readEnvHost();
  if (Platform.OS === 'web') {
    return '127.0.0.1';
  }
  return configured;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} (timeout ${ms}ms)`));
    }, ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}
