import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = '@cosp/credencial_cache/';

export type CredencialCachePayload = {
  empDocId: string;
  firstName?: string;
  lastName?: string;
  dni?: string;
  fileNumber?: string;
  category?: string;
  empresaNombre?: string;
  photoUrl?: string;
  verifyUrl?: string;
  cachedAt: number;
};

export async function readCredencialCache(empDocId: string): Promise<CredencialCachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + empDocId);
    if (!raw) return null;
    return JSON.parse(raw) as CredencialCachePayload;
  } catch {
    return null;
  }
}

export async function writeCredencialCache(payload: CredencialCachePayload): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + payload.empDocId, JSON.stringify(payload));
  } catch {
    /* no bloquear UI */
  }
}
