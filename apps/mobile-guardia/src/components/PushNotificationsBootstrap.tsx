import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { usePortalAuth } from '../context/PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';
import { routeFromNotificationData } from '../lib/notificationNavigation';
import { appRoutes } from '../lib/appRoutes';
import {
  getStoredFcmToken,
  registerPushNotifications,
  subscribeWebForegroundMessages,
  type PushRegistrationStatus,
} from '../lib/pushNotifications';
import { appAlert } from '@/lib/appAlert';

type PushNotificationsBootstrapProps = {
  onStatusChange?: (status: PushRegistrationStatus) => void;
};

function hrefFromRoute(route: string) {
  if (route === '/(tabs)' || route === '/(tabs)/') return appRoutes.hoy;
  if (route.startsWith('/(tabs)?')) return appRoutes.hoy;
  if (route === '/(tabs)/agenda') return appRoutes.agenda;
  if (route === '/(tabs)/alertas') return appRoutes.alertas;
  if (route === '/(tabs)/mas') return appRoutes.mas;
  if (route === '/eventos') return appRoutes.eventos;
  if (route === '/permutas') return appRoutes.permutas;
  if (route === '/novedad') return appRoutes.novedad;
  if (route === '/credencial') return appRoutes.credencial;
  return appRoutes.alertas;
}

function mapLegacyEmployeeLink(link: string): string {
  const raw = link.trim();
  if (!raw) return '/app/';
  if (raw.startsWith('/empleado')) return '/app/';
  if (raw.startsWith('/app')) return raw;
  return raw;
}

export function PushNotificationsBootstrap({ onStatusChange }: PushNotificationsBootstrapProps) {
  const router = useRouter();
  const {
    user,
    empDocId,
    employee,
    employeeProfileReady,
    deviceVerified,
    isSuperAdmin,
    isPreviewMode,
  } = usePortalAuth();
  const { db } = getPortalFirebase();
  const lastForegroundToastRef = useRef<string | null>(null);
  const handledColdStartRef = useRef(false);

  const openFromData = (data: Record<string, unknown>) => {
    const route = routeFromNotificationData(data);
    if (route) {
      router.push(hrefFromRoute(route));
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const link = mapLegacyEmployeeLink(String(data.link ?? data.route ?? data.path ?? '/app/'));
      if (link.startsWith('/app')) {
        window.location.href = link;
      }
    }
  };

  const canAutoRegister =
    !!user &&
    employeeProfileReady &&
    !!empDocId &&
    (isPreviewMode || (deviceVerified === true && !isSuperAdmin));

  useEffect(() => {
    if (!canAutoRegister || !user) return;

    let cancelled = false;

    (async () => {
      const result = await registerPushNotifications({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
        previewOf: isPreviewMode,
        interactive: false,
      });
      if (!cancelled) {
        onStatusChange?.(result.status);
        // En web 'off' = falta gesto; el botón «Activar notificaciones» lo resuelve.
        if (result.status === 'denied' && Platform.OS !== 'web') {
          appAlert(
            'Notificaciones',
            'Para recibir alertas operativas, activá notificaciones de COSP Guardia en Ajustes del teléfono.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    canAutoRegister,
    user?.uid,
    empDocId,
    employee?.empresaId,
    isPreviewMode,
    db,
    onStatusChange,
  ]);

  useEffect(() => {
    if (!user) return;

    if (Platform.OS === 'web') {
      let unsub: (() => void) | null = null;
      let cancelled = false;
      void subscribeWebForegroundMessages(({ title, body, data }) => {
        const dedupeKey = `${title}|${body}`;
        if (lastForegroundToastRef.current === dedupeKey) return;
        lastForegroundToastRef.current = dedupeKey;
        if (AppState.currentState === 'active') {
          const route = routeFromNotificationData(data);
          if (route) {
            appAlert(title, body || 'Nueva notificación', [
              { text: 'Después', style: 'cancel' },
              { text: 'Abrir', onPress: () => openFromData(data) },
            ]);
          } else {
            appAlert(title, body || 'Nueva notificación');
          }
          try {
            if (Notification.permission === 'granted') {
              const n = new Notification(title, { body });
              n.onclick = () => openFromData(data);
            }
          } catch {
            /* ignore */
          }
        }
      }).then((fn) => {
        if (cancelled) {
          fn?.();
          return;
        }
        unsub = fn;
      });
      return () => {
        cancelled = true;
        unsub?.();
      };
    }

    let Notifications: typeof import('expo-notifications');
    let received: { remove: () => void } | null = null;
    let response: { remove: () => void } | null = null;
    let cancelled = false;

    void import('expo-notifications').then((mod) => {
      if (cancelled) return;
      Notifications = mod;

      const openFromNotification = (notification: import('expo-notifications').Notification) => {
        const raw = notification.request.content.data;
        const data =
          raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
        openFromData(data);
      };

      if (!handledColdStartRef.current) {
        handledColdStartRef.current = true;
        void Notifications.getLastNotificationResponseAsync().then((resp) => {
          if (resp?.notification) openFromNotification(resp.notification);
        });
      }

      received = Notifications.addNotificationReceivedListener((notification) => {
        const title = notification.request.content.title ?? 'CronoApp';
        const body = notification.request.content.body ?? '';
        const dedupeKey = `${title}|${body}`;
        if (lastForegroundToastRef.current === dedupeKey) return;
        lastForegroundToastRef.current = dedupeKey;
        if (AppState.currentState === 'active') {
          const raw = notification.request.content.data;
          const data =
            raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : ({} as Record<string, unknown>);
          const route = routeFromNotificationData(data);
          if (route) {
            appAlert(title, body || 'Nueva notificación', [
              { text: 'Después', style: 'cancel' },
              { text: 'Abrir', onPress: () => openFromData(data) },
            ]);
          } else {
            appAlert(title, body || 'Nueva notificación');
          }
        }
      });

      response = Notifications.addNotificationResponseReceivedListener((event) => {
        lastForegroundToastRef.current = null;
        if (event.notification) openFromNotification(event.notification);
      });
    });

    return () => {
      cancelled = true;
      received?.remove();
      response?.remove();
    };
  }, [user?.uid, router]);

  useEffect(() => {
    if (!canAutoRegister || !user) return;

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      registerPushNotifications({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
        previewOf: isPreviewMode,
        interactive: false,
      }).then((r) => onStatusChange?.(r.status));
    });

    return () => sub.remove();
  }, [
    canAutoRegister,
    user,
    empDocId,
    employee?.empresaId,
    isPreviewMode,
    db,
    onStatusChange,
  ]);

  useEffect(() => {
    if (!user) return;
    getStoredFcmToken().then((token) => {
      if (token) onStatusChange?.('enabled');
    });
  }, [user?.uid, onStatusChange]);

  return null;
}
