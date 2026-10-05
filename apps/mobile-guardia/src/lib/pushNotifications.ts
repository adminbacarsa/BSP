import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import type { User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { getPortalFirebase } from './portal';
import { buildDeviceTokenDoc } from './deviceTokenDoc';
import {
  ALERTAS_TURNO_CHANNEL,
  ALERTAS_TURNO_CHANNEL_ID,
  ALERTAS_TURNO_CHANNEL_ID_LEGACY,
  ALERTAS_TURNO_CHANNEL_LEGACY,
  binaryHasAlertasTurnoSound,
} from './alertasTurnoChannel';
import {
  decidePushActivateAction,
  isAlertasChannelBlocked,
  resolvePushEstado,
  shouldShowPushRequiredBanner,
  pushGateReason,
  type AlertasChannelSnapshot,
  type PushActivateAction,
  type PushEstado,
  type PushGateReason,
  type PushPermissionSnapshot,
} from './pushPermissionGate';

export { buildDeviceTokenDoc } from './deviceTokenDoc';
export { ALERTAS_TURNO_CHANNEL_ID } from './alertasTurnoChannel';
export {
  decidePushActivateAction,
  isAlertasChannelBlocked,
  resolvePushEstado,
  shouldShowPushRequiredBanner,
  pushGateReason,
  PUSH_REQUIRED_TITLE,
  PUSH_REQUIRED_BODY,
  PUSH_REQUIRED_BUTTON,
  PUSH_REQUIRED_CHANNEL_BODY,
  type PushEstado,
  type PushGateReason,
  type PushActivateAction,
} from './pushPermissionGate';

let alertasTurnoChannelReady: Promise<void> | null = null;

/**
 * Crea el canal legado `alertas_turno` y, solo si el binario trae el wav,
 * `alertas_turno_v2`. Idempotente. No pide permiso. En iOS solo deja el handler.
 */
export function ensureAlertasTurnoChannel(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!alertasTurnoChannelReady) {
    alertasTurnoChannelReady = (async () => {
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
      if (Platform.OS !== 'android') return;
      await Notifications.setNotificationChannelAsync(ALERTAS_TURNO_CHANNEL_ID_LEGACY, {
        name: ALERTAS_TURNO_CHANNEL_LEGACY.name,
        description: ALERTAS_TURNO_CHANNEL_LEGACY.description,
        importance: Notifications.AndroidImportance.MAX,
        sound: ALERTAS_TURNO_CHANNEL_LEGACY.sound,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
      });
      if (!binaryHasAlertasTurnoSound(Constants.nativeAppVersion)) return;
      await Notifications.setNotificationChannelAsync(ALERTAS_TURNO_CHANNEL_ID, {
        name: ALERTAS_TURNO_CHANNEL.name,
        description: ALERTAS_TURNO_CHANNEL.description,
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [...ALERTAS_TURNO_CHANNEL.vibrationPattern],
        lightColor: '#D32F2F',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        sound: ALERTAS_TURNO_CHANNEL.sound,
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        audioAttributes: {
          usage: Notifications.AndroidAudioUsage.ALARM,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
          flags: {
            enforceAudibility: true,
            requestHardwareAudioVideoSynchronization: false,
          },
        },
      });
    })().catch((err) => {
      alertasTurnoChannelReady = null;
      throw err;
    });
  }
  return alertasTurnoChannelReady;
}

/** Paquete Android (ajustes de canal). */
function androidPackageName(): string {
  return Constants.expoConfig?.android?.package || 'com.cosp.guardia';
}

/** Permiso de notificaciones (nativo). En web: Notification.permission. */
export async function getPushPermissionSnapshot(): Promise<PushPermissionSnapshot> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return { status: 'denied', canAskAgain: false };
    }
    const p = Notification.permission;
    return {
      status: p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'undetermined',
      canAskAgain: p === 'default',
    };
  }
  const Notifications = await import('expo-notifications');
  const current = await Notifications.getPermissionsAsync();
  return {
    status: String(current.status || 'undetermined'),
    canAskAgain: current.canAskAgain !== false,
  };
}

/**
 * Estado del canal de alertas de turno (Android).
 * Mira v2 si el binario lo tiene; si no, el legado.
 */
export async function getAlertasChannelSnapshot(): Promise<AlertasChannelSnapshot> {
  if (Platform.OS !== 'android') {
    return { missing: false, importance: null };
  }
  const Notifications = await import('expo-notifications');
  const preferV2 = binaryHasAlertasTurnoSound(Constants.nativeAppVersion);
  const ids = preferV2
    ? [ALERTAS_TURNO_CHANNEL_ID, ALERTAS_TURNO_CHANNEL_ID_LEGACY]
    : [ALERTAS_TURNO_CHANNEL_ID_LEGACY];
  for (const id of ids) {
    try {
      const ch = await Notifications.getNotificationChannelAsync(id);
      if (ch) {
        return { missing: false, importance: typeof ch.importance === 'number' ? ch.importance : null };
      }
    } catch {
      /* siguiente */
    }
  }
  return { missing: true, importance: null };
}

export type NativePushGateSnapshot = {
  permission: PushPermissionSnapshot;
  channel: AlertasChannelSnapshot;
  channelBlocked: boolean;
  permissionGranted: boolean;
  needsBanner: boolean;
  reason: PushGateReason;
  activateAction: PushActivateAction;
  unsupported: boolean;
};

/** Foto completa del gate nativo (permiso + canal). */
export async function getNativePushGateSnapshot(): Promise<NativePushGateSnapshot> {
  const unsupported = Platform.OS !== 'web' && !Device.isDevice;
  const permission = await getPushPermissionSnapshot();
  const permissionGranted = permission.status === 'granted';
  let channel: AlertasChannelSnapshot = { missing: false, importance: null };
  if (Platform.OS === 'android' && permissionGranted) {
    // Asegura que el canal exista antes de leer importancia.
    try {
      await ensureAlertasTurnoChannel();
    } catch {
      /* ignore */
    }
    channel = await getAlertasChannelSnapshot();
  }
  const channelBlocked = isAlertasChannelBlocked(channel);
  return {
    permission,
    channel,
    channelBlocked,
    permissionGranted,
    needsBanner: shouldShowPushRequiredBanner({
      platform: Platform.OS,
      permissionGranted,
      channelBlocked,
      unsupported,
    }),
    reason: pushGateReason({ permissionGranted, channelBlocked }),
    activateAction: decidePushActivateAction({ permission, channelBlocked }),
    unsupported,
  };
}

/** Abre Ajustes de la app, o del canal de alertas en Android si se puede. */
export async function openPushSettings(opts?: { channelId?: string }): Promise<void> {
  if (Platform.OS === 'android' && opts?.channelId) {
    try {
      await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: androidPackageName() },
        { key: 'android.provider.extra.CHANNEL_ID', value: opts.channelId },
      ]);
      return;
    } catch {
      /* cae a openSettings */
    }
  }
  await Linking.openSettings();
}

/**
 * Escribe `pushEstado` / `pushEstadoAt` en el legajo (y en el token si hay).
 * El CC puede leer el legajo y mostrar «sin notificaciones».
 */
export async function persistPushEstado(params: {
  db: Firestore;
  empDocId: string | null;
  estado: PushEstado;
  token?: string | null;
}): Promise<void> {
  const { db, empDocId, estado, token } = params;
  const patch = { pushEstado: estado, pushEstadoAt: serverTimestamp() };
  if (empDocId) {
    try {
      await updateDoc(doc(db, 'empleados', empDocId), patch);
    } catch {
      /* sin permiso o legajo inexistente: no romper el flujo */
    }
  }
  if (token) {
    try {
      await setDoc(doc(db, 'device_tokens', token), { ...patch }, { merge: true });
    } catch {
      /* ignore */
    }
  }
}

export type PushRegistrationStatus = 'unsupported' | 'off' | 'denied' | 'enabled' | 'error';

export type ActivatePushResult = {
  status: PushRegistrationStatus;
  action: PushActivateAction;
  openedSettings: boolean;
  token?: string;
  error?: string;
  gate?: NativePushGateSnapshot;
};

/**
 * «Activar ahora»: pide permiso si se puede; si no, abre Ajustes.
 * Tras conceder, registra el token FCM.
 */
export async function activatePushNow(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
  previewOf?: boolean;
}): Promise<ActivatePushResult> {
  if (Platform.OS === 'web') {
    const reg = await registerPushNotifications({ ...params, interactive: true });
    return { status: reg.status, action: 'request', openedSettings: false, token: reg.token, error: reg.error };
  }

  const gate = await getNativePushGateSnapshot();
  if (gate.unsupported) {
    return { status: 'unsupported', action: 'none', openedSettings: false, gate, error: 'Sin dispositivo físico.' };
  }

  const action = gate.activateAction;
  if (action === 'request') {
    const Notifications = await import('expo-notifications');
    await Notifications.requestPermissionsAsync();
  }

  const afterRequest = await getNativePushGateSnapshot();
  if (afterRequest.permissionGranted && !afterRequest.channelBlocked) {
    const reg = await registerPushNotifications({ ...params, interactive: true });
    const stored = reg.token || (await getStoredFcmToken());
    const estado = resolvePushEstado({
      permissionGranted: true,
      hasToken: !!stored,
      channelBlocked: false,
    });
    await persistPushEstado({ db: params.db, empDocId: params.empDocId, estado, token: stored });
    return {
      status: reg.status,
      action,
      openedSettings: false,
      token: reg.token,
      error: reg.error,
      gate: afterRequest,
    };
  }

  // Denegado o canal bloqueado: abrir Ajustes (canal si aplica).
  const channelId =
    afterRequest.channelBlocked || afterRequest.reason === 'channel'
      ? binaryHasAlertasTurnoSound(Constants.nativeAppVersion)
        ? ALERTAS_TURNO_CHANNEL_ID
        : ALERTAS_TURNO_CHANNEL_ID_LEGACY
      : undefined;
  await openPushSettings(channelId ? { channelId } : undefined);
  await persistPushEstado({
    db: params.db,
    empDocId: params.empDocId,
    estado: 'denegado',
    token: await getStoredFcmToken(),
  });
  return {
    status: 'denied',
    action: action === 'request' ? 'open_settings' : action,
    openedSettings: true,
    gate: afterRequest,
  };
}

/** Misma clave que el portal web viejo `/empleado` (localStorage). */
export const WEB_FCM_STORAGE_KEY = 'fcm_token';
const NATIVE_FCM_STORAGE_KEY = '@cosp/mobile_fcm_token';

export type RegisterPushOptions = {
  /**
   * SuperAdmin en preview: token del dispositivo del SA atado al legajo visto.
   * Las Functions buscan por employeeId → el SA recibe las push de ese guardia.
   */
  previewOf?: boolean;
  /**
   * Solo con gesto del usuario (botón). En web Safari/iOS exige gesto para
   * Notification.requestPermission(); sin interactive no pedimos permiso.
   */
  interactive?: boolean;
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
}): Promise<void> {
  const { user, db, empDocId, empresaId, token, platform, previewOf } = params;
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
    nativeVersion: platform === 'web' ? null : Constants.nativeAppVersion,
    pushEstado: 'activo',
  });

  await setDoc(
    doc(db, 'device_tokens', token),
    { ...payload, pushEstadoAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
  await persistTokenLocal(token);
  await persistPushEstado({ db, empDocId, estado: 'activo', token });
}

async function registerWebPush(params: {
  user: User;
  db: Firestore;
  empDocId: string | null;
  empresaId: string | null;
  previewOf?: boolean;
  interactive?: boolean;
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const { user, db, empDocId, empresaId, previewOf, interactive } = params;

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

  const { user, db, empDocId, empresaId, previewOf, interactive } = params;

  if (!Device.isDevice) {
    return { status: 'unsupported', error: 'El emulador del teléfono no recibe push FCM nativo.' };
  }

  if (Platform.OS === 'android') {
    await ensureAlertasTurnoChannel();
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
    // Nativo: se puede pedir en bootstrap; interactive fuerza el prompt si hacía falta.
    // Sin interactive y ya denied: no re-prompt (el banner «Activar ahora» sí lo fuerza).
    if (!interactive && permission === 'denied') {
      await persistPushEstado({ db, empDocId, estado: 'denegado', token: await getStoredFcmToken() });
      return { status: 'denied' };
    }
    const requested = await Notifications.requestPermissionsAsync();
    permission = requested.status;
  }

  if (permission !== 'granted') {
    const denied = permission === 'denied';
    await persistPushEstado({
      db,
      empDocId,
      estado: denied ? 'denegado' : 'sin_token',
      token: await getStoredFcmToken(),
    });
    return { status: denied ? 'denied' : 'off' };
  }

  if (Platform.OS === 'android') {
    const channel = await getAlertasChannelSnapshot();
    if (isAlertasChannelBlocked(channel)) {
      await persistPushEstado({ db, empDocId, estado: 'denegado', token: await getStoredFcmToken() });
      return { status: 'denied', error: 'Canal de alertas apagado o en silencio.' };
    }
  }

  try {
    const devicePush = await Notifications.getDevicePushTokenAsync();
    const token = typeof devicePush.data === 'string' ? devicePush.data.trim() : '';
    if (token.length < 10) {
      await persistPushEstado({ db, empDocId, estado: 'sin_token' });
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
    });
    return { status: 'enabled', token };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo registrar push';
    await persistPushEstado({ db, empDocId, estado: 'sin_token', token: await getStoredFcmToken() });
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
}): Promise<{ status: PushRegistrationStatus; token?: string; error?: string }> {
  const { previewOf, interactive, ...rest } = params;
  if (Platform.OS === 'web') {
    return registerWebPush({ ...rest, previewOf, interactive });
  }
  return registerNativePush({ ...rest, previewOf, interactive });
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
      const title = String(data.title || payload.notification?.title || 'CronoApp');
      const body = String(data.body || payload.notification?.body || '');
      onPayload({ title, body, data });
    });
  } catch {
    return null;
  }
}
