import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, getFirestore, memoryLocalCache, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

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

/** Conecta Auth/Firestore/Functions al lab local (idempotente). Llamar antes del primer signIn. */
export function ensureFirebaseEmulatorsConnected(): void {
  if (typeof window === 'undefined' || !USE_EMULATOR) return;
  const host = getEmulatorHost();
  if (!isAuthOnEmulator()) {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
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
}

// Cache en memoria (estable en todos los navegadores). La persistencia IndexedDB
// quedó descartada: si IndexedDB se bloquea (multipestaña/storage restringido),
// los getDoc nunca resuelven y el login se cuelga ("pensando" infinito).
let db;
if (typeof window === 'undefined') {
  db = getFirestore(app);
} else if (USE_EMULATOR) {
  try {
    db = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch {
    db = getFirestore(app);
  }
  ensureFirebaseEmulatorsConnected();
  console.info(
    `[Firebase] Modo emulador activo → ${getEmulatorHost()} (auth 9099, firestore 8080, functions 5001, storage 9199) 🧪`,
  );
} else {
  try {
    db = initializeFirestore(app, {
      localCache: memoryLocalCache(),
    });
  } catch {
    db = getFirestore(app);
  }
}

export { app, auth, db, functions, storage };