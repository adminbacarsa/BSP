import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  type Auth,
} from 'firebase/auth';
import { Platform } from 'react-native';
import {
  createPortalFirebase,
  createPortalCallables,
  validateFirebaseConfig,
  type PortalFirebase,
  type PortalCallables,
} from '@cosp/portal-core';
import type { PortalCoreConfig } from '@cosp/portal-types';

function resolveNativeAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

type ExpoExtra = {
  useEmulator?: boolean;
  emulatorHost?: string;
  firebase?: PortalCoreConfig['firebase'];
};

let portal: PortalFirebase | null = null;
let callables: PortalCallables | null = null;

function getExtra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

export function getPortalCoreConfig(): PortalCoreConfig {
  const extra = getExtra();
  return {
    firebase: {
      apiKey: extra.firebase?.apiKey ?? '',
      authDomain: extra.firebase?.authDomain ?? '',
      projectId: extra.firebase?.projectId ?? '',
      storageBucket: extra.firebase?.storageBucket ?? '',
      messagingSenderId: extra.firebase?.messagingSenderId ?? '',
      appId: extra.firebase?.appId ?? '',
    },
    useEmulator: extra.useEmulator === true,
    emulatorHost: extra.emulatorHost,
    functionsRegion: 'us-central1',
  };
}

export function getPortalFirebase(): PortalFirebase {
  if (!portal) {
    const config = getPortalCoreConfig();
    const check = validateFirebaseConfig(config);
    if (!check.ok) {
      throw new Error(`Firebase incompleto: faltan ${check.missing.join(', ')}`);
    }
    portal = createPortalFirebase(config, {
      resolveAuth:
        Platform.OS === 'web'
          ? undefined
          : (app) => resolveNativeAuth(app),
    });
  }
  return portal;
}

export function getPortalCallables(): PortalCallables {
  if (!callables) {
    const { functions } = getPortalFirebase();
    callables = createPortalCallables(functions);
  }
  return callables;
}

export function isEmulatorMode(): boolean {
  return getPortalCoreConfig().useEmulator;
}

export function getEmulatorHostLabel(): string {
  return getPortalCoreConfig().emulatorHost?.trim() || '127.0.0.1';
}

/** En dispositivo físico, 127.0.0.1 apunta al teléfono, no a la PC. */
export function isEmulatorHostMisconfiguredForDevice(): boolean {
  if (!isEmulatorMode() || Platform.OS === 'web') return false;
  const host = getEmulatorHostLabel();
  return host === '127.0.0.1' || host === 'localhost';
}
