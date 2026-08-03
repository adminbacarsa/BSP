import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import type { User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const FCM_STORAGE_KEY = '@cosp/mobile_fcm_token';

export type PushRegistrationStatus = 'unsupported' | 'off' | 'denied' | 'enabled' | 'error';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function getStoredFcmToken(): Promise<string | null> {
  return AsyncStorage.getItem(FCM_STORAGE_KEY);
}

export async function clearPushTokenOnServer(db: Firestore, token: string | null): Promise<void> {
  if (!token) {
    await AsyncStorage.removeItem(FCM_STORAGE_KEY);
    return;
  }
  try {
    await deleteDoc(doc(db, 'device_tokens', token));
  } catch {
    /* token doc puede no existir */
  }
  await AsyncStorage.removeItem(FCM_STORAGE_KEY);
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'COSP Guardia',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#312e81',
  });
}

export async function registerPushNotifications(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const { user, db, empDocId, empresaId } = params;

  if (!Device.isDevice) {
    return { status: 'unsupported', error: 'El emulador del teléfono no recibe push FCM nativo.' };
  }

  await ensureAndroidChannel();

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

    const platform =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'native';

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
    await AsyncStorage.setItem(FCM_STORAGE_KEY, token);
    return { status: 'enabled', token };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo registrar push';
    return { status: 'error', error: message };
  }
}

export async function unregisterPushForUser(db: Firestore): Promise<void> {
  const token = await getStoredFcmToken();
  await clearPushTokenOnServer(db, token);
}
