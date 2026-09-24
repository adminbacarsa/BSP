import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import type { User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getPortalFirebase } from './portal';

/** Misma clave que el portal web viejo `/empleado` (localStorage). */
export const WEB_FCM_STORAGE_KEY = 'fcm_token';
const NATIVE_FCM_STORAGE_KEY = '@cosp/mobile_fcm_token';

export type PushRegistrationStatus = 'unsupported' | 'off' | 'denied' | 'enabled' | 'error';

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

async function registerWebPush(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const { user, db, empDocId, empresaId } = params;

  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return { status: 'unsupported', error: 'Este navegador no soporta notificaciones push.' };
  }

  const vapidKey = getVapidKey();
  if (!vapidKey) {
    return { status: 'error', error: 'Falta EXPO_PUBLIC_FIREBASE_VAPID_KEY (misma que web2).' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
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

    const oldToken = await getStoredFcmToken();
    if (oldToken && oldToken !== token) {
      await clearPushTokenOnServer(db, oldToken);
    }

    await setDoc(
      doc(db, 'device_tokens', token),
      {
        uid: user.uid,
        employeeId: empDocId || null,
        empresaId: empresaId || null,
        role: 'employee',
        token,
        platform: 'web',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await persistTokenLocal(token);
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

  const { user, db, empDocId, empresaId } = params;

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
  }

  const current = await Notifications.getPermissionsAsync();
  let permission = current.status;
  if (permission !== 'granted') {
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

    const oldToken = await getStoredFcmToken();
    if (oldToken && oldToken !== token) {
      await clearPushTokenOnServer(db, oldToken);
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    await setDoc(
      doc(db, 'device_tokens', token),
      {
        uid: user.uid,
        employeeId: empDocId || null,
        empresaId: empresaId || null,
        role: 'employee',
        token,
        platform,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    await persistTokenLocal(token);
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
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  if (Platform.OS === 'web') {
    return registerWebPush(params);
  }
  return registerNativePush(params);
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
      const title = String(data.title || payload.notification?.title || 'CronoApp');
      const body = String(data.body || payload.notification?.body || '');
      onPayload({ title, body, data });
    });
  } catch {
    return null;
  }
}
