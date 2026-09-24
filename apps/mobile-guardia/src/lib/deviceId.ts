import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'cosp_device_id';
const IDB_DB_NAME = 'cosp_guardia';
const IDB_STORE = 'kv';

export type MobilePlatform = 'ios' | 'android' | 'web';

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function isWebRuntime(): boolean {
  return Platform.OS === 'web' || typeof window !== 'undefined';
}

function readLocalStorage(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(DEVICE_ID_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(id: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    /* modo privado / cuota */
  }
}

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readIndexedDb(): Promise<string | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(DEVICE_ID_KEY);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === 'string' && v.trim() ? v.trim() : null);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(null);
    }
  });
}

async function writeIndexedDb(id: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(id, DEVICE_ID_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

/** Persistencia web: localStorage + IndexedDB (Safari puede borrar LS a los 7 días sin uso). */
async function getOrCreateWebDeviceId(): Promise<string> {
  const fromLs = readLocalStorage();
  const fromIdb = await readIndexedDb();
  const existing = fromLs || fromIdb;
  if (existing) {
    if (!fromLs) writeLocalStorage(existing);
    if (!fromIdb) await writeIndexedDb(existing);
    return existing;
  }
  const id = randomId();
  writeLocalStorage(id);
  await writeIndexedDb(id);
  return id;
}

async function getStoredWebDeviceId(): Promise<string | null> {
  const fromLs = readLocalStorage();
  if (fromLs) {
    await writeIndexedDb(fromLs);
    return fromLs;
  }
  const fromIdb = await readIndexedDb();
  if (fromIdb) {
    writeLocalStorage(fromIdb);
    return fromIdb;
  }
  return null;
}

export async function getOrCreateDeviceId(): Promise<string> {
  if (isWebRuntime() && Platform.OS === 'web') {
    try {
      return await getOrCreateWebDeviceId();
    } catch {
      return randomId();
    }
  }
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = randomId();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

export async function getStoredDeviceId(): Promise<string | null> {
  if (isWebRuntime() && Platform.OS === 'web') {
    try {
      return await getStoredWebDeviceId();
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

export function getMobilePlatform(): MobilePlatform {
  if (Platform.OS === 'web') return 'web';
  if (Platform.OS === 'ios') return 'ios';
  return 'android';
}
