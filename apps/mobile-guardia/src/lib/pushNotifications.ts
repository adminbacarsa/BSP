import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import type { User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getPortalFirebase } from './portal';
import { buildDeviceTokenDoc } from './deviceTokenDoc';
import type { DeviceTokenAudience } from './deviceTokenDoc';

export { buildDeviceTokenDoc } from './deviceTokenDoc';
export type { DeviceTokenAudience } from './deviceTokenDoc';

/** Misma clave que el portal web viejo `/empleado` (localStorage). */
export const WEB_FCM_STORAGE_KEY = 'fcm_token';
const NATIVE_FCM_STORAGE_KEY = '@cosp/mobile_fcm_token';

export type PushRegistrationStatus = 'unsupported' | 'off' | 'denied' | 'enabled' | 'error';

export type RegisterPushOptions = {
  previewOf?: boolean;
  interactive?: boolean;
  audience?: DeviceTokenAudience;
};

function getVapidKey(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { vapidKey?: string };
  return (extra.vapidKey || process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY || '').trim();
}

export async function getStoredFcmToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem(WEB_FCM_STORAGE_KEY);
        if (v) return v;
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  return AsyncStorage.getItem(NATIVE_FCM_STORAGE_KEY);
}

async function persistTokenLocal(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(WEB_FCM_STORAGE_KEY, token);
    } catch {
      /* ignore */
    }
    return;
  }
  await AsyncStorage.setItem(NATIVE_FCM_STORAGE_KEY, token);
}

async function clearTokenLocal(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.removeItem(WEB_FCM_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await AsyncStorage.removeItem(NATIVE_FCM_STORAGE_KEY);
}

/** Borra `device_tokens/{token}` en servidor y limpia storage local. */
export async function clearPushTokenOnServer(db: Firestore, token: string | null): Promise<void> {
  if (!token) {
    await clearTokenLocal();
    return;
  }
  try {
    await deleteDoc(doc(db, 'device_tokens', token));
  } catch {
    /* token doc puede no existir */
  }
  await clearTokenLocal();
}

/**
 * Sale de preview: borra el doc FCM del servidor (deja de recibir push del legajo)
 * pero conserva el token local para re-atar al entrar a otro preview sin re-prompt.
 */
export async function detachPushTokenOnServer(db: Firestore): Promise<void> {
  const token = await getStoredFcmToken();
  if (!token) return;
  try {
    await deleteDoc(doc(db, 'device_tokens', token));
  } catch {
    /* ignore */
  }
}

async function persistTokenDoc(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
  token: string;
  platform: 'web' | 'ios' | 'android';
  previewOf?: boolean;
  audience?: DeviceTokenAudience;
}): Promise<void> {
  const { user, db, empDocId, empresaId, token, platform, previewOf, audience } = params;
  const oldToken = await getStoredFcmToken();
  if (oldToken && oldToken !== token) {
    await clearPushTokenOnServer(db, oldToken);
  }

  const payload = buildDeviceTokenDoc({
    uid: user.uid,
    employeeId: empDocId,
    empresaId,
    token,
    platform,
    previewOf,
    audience,
  });

  await setDoc(
    doc(db, 'device_tokens', token),
    { ...payload, updatedAt: serverTimestamp() },
    { merge: true },
  );
  await persistTokenLocal(token);
}

async function registerWebPush(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
  previewOf?: boolean;
  interactive?: boolean;
  audience?: DeviceTokenAudience;
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const { user, db, empDocId, empresaId, previewOf, interactive, audience } = params;

  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return { status: 'unsupported', error: 'Este navegador no soporta notificaciones push.' };
  }

  const vapidKey = getVapidKey();
  if (!vapidKey) {
    return { status: 'error', error: 'Falta EXPO_PUBLIC_FIREBASE_VAPID_KEY (misma que web2).' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    if (!interactive) {
      // Safari/iOS exige gesto del usuario: no pedir permiso en auto-bootstrap.
      return { status: 'off' };
    }
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { status: permission === 'denied' ? 'denied' : 'off' };
  }

  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const { getMessaging, getToken } = await import('firebase/messaging');
    const { app } = getPortalFirebase();
    const messaging = getMessaging(app);
    const token = (await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })).trim();
    if (!token || token.length < 10) {
      return { status: 'error', error: 'No se obtuvo un token FCM web válido.' };
    }

    await persistTokenDoc({
      user,
      db,
      empDocId,
      empresaId,
      token,
      platform: 'web',
      previewOf,
      audience,
    });
    return { status: 'enabled', token };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo registrar push web';
    return { status: 'error', error: message };
  }
}

async function registerNativePush(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
  previewOf?: boolean;
  interactive?: boolean;
  audience?: DeviceTokenAudience;
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const Notifications = await import('expo-notifications');

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  const { user, db, empDocId, empresaId, previewOf, interactive, audience } = params;

  if (!Device.isDevice) {
    return { status: 'unsupported', error: 'El emulador del teléfono no recibe push FCM nativo.' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'COSP Guardia',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#312e81',
    });
    await Notifications.setNotificationChannelAsync('cosp-staff', {
      name: 'COSP Staff',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#0f766e',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let permission = current.status;
  if (permission !== 'granted') {
    // Nativo: se puede pedir en bootstrap; interactive fuerza el prompt si hacía falta.
    if (!interactive && permission === 'denied') {
      return { status: 'denied' };
    }
    const requested = await Notifications.requestPermissionsAsync();
    permission = requested.status;
  }

  if (permission !== 'granted') {
    return { status: permission === 'denied' ? 'denied' : 'off' };
  }

  try {
    const devicePush = await Notifications.getDevicePushTokenAsync();
    const token = typeof devicePush.data === 'string' ? devicePush.data.trim() : '';
    if (token.length < 10) {
      return { status: 'error', error: 'No se obtuvo un token FCM válido.' };
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await persistTokenDoc({
      user,
      db,
      empDocId,
      empresaId,
      token,
      platform,
      previewOf,
      audience,
    });
    return { status: 'enabled', token };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo registrar push';
    return { status: 'error', error: message };
  }
}

export async function registerPushNotifications(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
  previewOf?: boolean;
  interactive?: boolean;
  audience?: DeviceTokenAudience;
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const { previewOf, interactive, audience, ...rest } = params;
  if (Platform.OS === 'web') {
    return registerWebPush({ ...rest, previewOf, interactive, audience });
  }
  return registerNativePush({ ...rest, previewOf, interactive, audience });
}

export async function unregisterPushForUser(db: Firestore): Promise<void> {
  const token = await getStoredFcmToken();
  await clearPushTokenOnServer(db, token);
  if (Platform.OS === 'web') {
    try {
      const { getMessaging, deleteToken } = await import('firebase/messaging');
      const { app } = getPortalFirebase();
      await deleteToken(getMessaging(app));
    } catch {
      /* ignore */
    }
  }
}

/** ¿Hace falta el botón «Activar notificaciones» en web? */
export function webPushNeedsUserGesture(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  return Notification.permission !== 'granted';
}

/** Escucha foreground FCM web; retorna unsubscribe o null. */
export async function subscribeWebForegroundMessages(
  onPayload: (payload: {
    title: string;
    body: string;
    data: Record<string, unknown>;
  }) => void,
): Promise<(() => void) | null> {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  try {
    const { getMessaging, onMessage } = await import('firebase/messaging');
    const { app } = getPortalFirebase();
    const messaging = getMessaging(app);
    return onMessage(messaging, (payload) => {
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const title = String(data.title || payload.notification?.title || 'COSP');
      const body = String(data.body || payload.notification?.body || '');
      onPayload({ title, body, data });
    });
  } catch {
    return null;
  }
}
