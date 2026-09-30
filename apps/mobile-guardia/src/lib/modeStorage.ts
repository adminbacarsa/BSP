import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { AppModeId } from '@cosp/ops-core';

const MODE_KEY = '@cosp/app_mode';
const EMPRESA_KEY = '@cosp/active_empresa';

async function storageGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function storageSet(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function storageRemove(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const MODE_IDS: AppModeId[] = ['guardia', 'operacion', 'supervision', 'rrhh', 'planificacion'];

export async function loadPersistedMode(): Promise<AppModeId | null> {
  const raw = await storageGet(MODE_KEY);
  if (!raw) return null;
  return MODE_IDS.includes(raw as AppModeId) ? (raw as AppModeId) : null;
}

export async function persistMode(mode: AppModeId): Promise<void> {
  await storageSet(MODE_KEY, mode);
}

export async function clearPersistedMode(): Promise<void> {
  await storageRemove(MODE_KEY);
}

export async function loadPersistedEmpresaId(): Promise<string | null> {
  return storageGet(EMPRESA_KEY);
}

export async function persistEmpresaId(empresaId: string): Promise<void> {
  await storageSet(EMPRESA_KEY, empresaId);
}

export async function clearPersistedEmpresaId(): Promise<void> {
  await storageRemove(EMPRESA_KEY);
}
