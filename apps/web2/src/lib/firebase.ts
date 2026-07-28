import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  connectFirestoreEmulator,
  onSnapshot as _onSnapshot,
  type Firestore,
  type Query,
  type DocumentReference,
  type CollectionReference,
  type QuerySnapshot,
  type DocumentSnapshot,
  type Unsubscribe,
  type SnapshotListenOptions,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

/**
 * onSnapshot que ignora el primer snapshot si viene del cache local.
 * Previene datos obsoletos al navegar entre páginas en la SPA.
 * Úsalo en lugar de onSnapshot para cargas iniciales de página.
 */
export function onSnapshotFresh<T = any>(
  ref: DocumentReference<T>,
  callback: (snap: DocumentSnapshot<T>) => void,
  onError?: (error: Error) => void,
): Unsubscribe;
export function onSnapshotFresh<T = any>(
  ref: Query<T> | CollectionReference<T>,
  callback: (snap: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
): Unsubscribe;
export function onSnapshotFresh<T = any>(
  ref: DocumentReference<T>,
  options: SnapshotListenOptions,
  callback: (snap: DocumentSnapshot<T>) => void,
  onError?: (error: Error) => void,
): Unsubscribe;
export function onSnapshotFresh<T = any>(
  ref: Query<T> | CollectionReference<T>,
  options: SnapshotListenOptions,
  callback: (snap: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
): Unsubscribe;
export function onSnapshotFresh(ref: any, ...args: any[]): Unsubscribe {
  const hasOptions = args[0] && typeof args[0] === 'object' && typeof args[0] !== 'function' && !('apply' in args[0]);
  const [options, callback, onError] = hasOptions
    ? [args[0] as SnapshotListenOptions, args[1], args[2]]
    : [{} as SnapshotListenOptions, args[0], args[1]];

  return _onSnapshot(
    ref,
    { ...options, includeMetadataChanges: true },
    (snap: any) => { if (!snap.metadata?.fromCache) callback(snap); },
    onError,
  );
}

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

/**
 * Dónde conectar los emuladores (Auth/Firestore/Functions):
 * 1) NEXT_PUBLIC_FIREBASE_EMULATOR_HOST si está definida (front y emuladores en PCs distintos).
 * 2) Si abres la app por IP/hostname en la barra (p. ej. http://192.168.0.174:3000), usa ese host
 *    para que coincida con IP DHCP sin tocar .env.
 * 3) Si abres por localhost/127.0.0.1, usa localhost.
 */
export function getEmulatorHost(): string {
  const explicit = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST?.trim();
  if (explicit) return explicit;
  // El suite Firebase corre en esta PC; aunque abras :3000 por IP LAN, los emuladores están en loopback.
  if (USE_EMULATOR) return '127.0.0.1';
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') return h;
  }
  return '127.0.0.1';
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Singleton para evitar reinicializaciones
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
const storage = getStorage(app);

function isAuthOnEmulator(): boolean {
  return Boolean((auth as unknown as { _emulatorConfig?: { host?: string } })._emulatorConfig?.host);
}

let _db: Firestore | undefined;
let _emulatorsConnected = false;

function createFirestoreInstance(): Firestore {
  if (typeof window === 'undefined') {
    return getFirestore(app);
  }
  if (USE_EMULATOR) {
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

/**
 * Firestore singleton — resolver en runtime (evita db inválido en hidratación Next.js).
 */
export function getDb(): Firestore {
  if (!_db) {
    _db = createFirestoreInstance();
    if (typeof window !== 'undefined' && USE_EMULATOR) {
      console.info(
        `[Firebase] Modo emulador activo → ${getEmulatorHost()} (auth 9099, firestore 8080, functions 5001, storage 9199) 🧪`,
      );
    }
  }
  return _db;
}

/** Conecta Auth/Firestore/Functions al lab local (idempotente). Llamar antes del primer signIn. */
export function ensureFirebaseEmulatorsConnected(): void {
  if (typeof window === 'undefined' || !USE_EMULATOR) return;
  const host = getEmulatorHost();
  if (!isAuthOnEmulator()) {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  }
  try {
    connectFirestoreEmulator(getDb(), host, 8080);
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
  _emulatorsConnected = true;
}

export const db: Firestore = getDb();

if (typeof window !== 'undefined' && USE_EMULATOR) {
  ensureFirebaseEmulatorsConnected();
}

export { app, auth, functions, storage };