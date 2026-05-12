import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentSingleTabManager, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

/**
 * Dónde conectar los emuladores (Auth/Firestore/Functions):
 * 1) NEXT_PUBLIC_FIREBASE_EMULATOR_HOST si está definida (front y emuladores en PCs distintos).
 * 2) Si abres la app por IP/hostname en la barra (p. ej. http://192.168.0.174:3000), usa ese host
 *    para que coincida con IP DHCP sin tocar .env.
 * 3) Si abres por localhost/127.0.0.1, usa localhost.
 */
function getEmulatorHost(): string {
  const explicit = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST?.trim();
  if (explicit) return explicit;
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') return h;
  }
  return 'localhost';
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

// Persistencia offline: cachea datos en IndexedDB y sincroniza al volver la conexión
// initializeFirestore solo puede llamarse una vez; getFirestore devuelve la instancia existente
let db;
try {
  db = typeof window !== 'undefined'
    ? initializeFirestore(app, {
        // forceOwnership: true garantiza que esta ventana siempre sea la propietaria del caché
        // (apropiado para PWA que corre como ventana única)
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager({ forceOwnership: true })
        })
      })
    : getFirestore(app);
} catch {
  // Ya inicializado (hot reload en dev)
  db = getFirestore(app);
}

const functions = getFunctions(app);
const storage = getStorage(app);

// Conectar emuladores en modo local
if (USE_EMULATOR && typeof window !== 'undefined') {
  try {
    const host = getEmulatorHost();
    connectFirestoreEmulator(db, host, 8080);
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFunctionsEmulator(functions, host, 5001);
    console.info(`[Firebase] Modo emulador activo → ${host} (auth 9099, firestore 8080, functions 5001) 🧪`);
  } catch (_) {
    // ya conectado (hot reload)
  }
}

export { app, auth, db, functions, storage };