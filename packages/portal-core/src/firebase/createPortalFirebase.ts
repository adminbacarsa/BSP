import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import type { PortalCoreConfig } from '@cosp/portal-types';

export type PortalFirebase = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
  connectEmulators: () => void;
  isEmulatorConnected: () => boolean;
};

let emulatorsConnected = false;

function resolveEmulatorHost(config: PortalCoreConfig): string {
  return config.emulatorHost?.trim() || '127.0.0.1';
}

function createFirestore(app: FirebaseApp, useEmulator: boolean): Firestore {
  if (useEmulator) {
    try {
      return initializeFirestore(app, {
        localCache: memoryLocalCache(),
        experimentalForceLongPolling: true,
      });
    } catch {
      return getFirestore(app);
    }
  }
  return getFirestore(app);
}

export function createPortalFirebase(config: PortalCoreConfig): PortalFirebase {
  const app = getApps().length ? getApp() : initializeApp(config.firebase);
  const auth = getAuth(app);
  const db = createFirestore(app, config.useEmulator);
  const functions = getFunctions(app, config.functionsRegion ?? 'us-central1');
  const storage = getStorage(app);

  const connectEmulators = () => {
    if (!config.useEmulator || emulatorsConnected) return;
    const host = resolveEmulatorHost(config);

    try {
      connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    } catch {
      /* ya conectado */
    }
    try {
      connectFirestoreEmulator(db, host, 8080);
    } catch {
      /* ya conectado */
    }
    try {
      connectFunctionsEmulator(functions, host, 5001);
    } catch {
      /* ya conectado */
    }
    try {
      connectStorageEmulator(storage, host, 9199);
    } catch {
      /* ya conectado */
    }

    emulatorsConnected = true;
  };

  if (config.useEmulator) {
    connectEmulators();
  }

  return {
    app,
    auth,
    db,
    functions,
    storage,
    connectEmulators,
    isEmulatorConnected: () => emulatorsConnected,
  };
}

export function validateFirebaseConfig(config: PortalCoreConfig): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const f = config.firebase;
  if (!f.apiKey) missing.push('apiKey');
  if (!f.authDomain) missing.push('authDomain');
  if (!f.projectId) missing.push('projectId');
  if (!f.storageBucket) missing.push('storageBucket');
  if (!f.messagingSenderId) missing.push('messagingSenderId');
  if (!f.appId) missing.push('appId');
  return { ok: missing.length === 0, missing };
}
