import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { usePortalAuth } from '../context/PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';
import {
  routeFromNotification,
} from '../lib/notificationNavigation';
import { appRoutes } from '../lib/appRoutes';
import {
  getStoredFcmToken,
  registerPushNotifications,
  type PushRegistrationStatus,
} from '../lib/pushNotifications';

type PushNotificationsBootstrapProps = {
  onStatusChange?: (status: PushRegistrationStatus) => void;
};

function hrefFromRoute(route: string) {
  if (route === '/(tabs)' || route === '/(tabs)/') return appRoutes.hoy;
  if (route === '/(tabs)/agenda') return appRoutes.agenda;
  if (route === '/(tabs)/alertas') return appRoutes.alertas;
  if (route === '/(tabs)/mas') return appRoutes.mas;
  if (route === '/eventos') return appRoutes.eventos;
  if (route === '/permutas') return appRoutes.permutas;
  if (route === '/novedad') return appRoutes.novedad;
  if (route === '/credencial') return appRoutes.credencial;
  return appRoutes.alertas;
}

export function PushNotificationsBootstrap({ onStatusChange }: PushNotificationsBootstrapProps) {
  const router = useRouter();
  const { user, empDocId, employee, employeeProfileReady } = usePortalAuth();
  const { db } = getPortalFirebase();
  const lastForegroundToastRef = useRef<string | null>(null);
  const handledColdStartRef = useRef(false);

  const openFromNotification = (notification: Notifications.Notification) => {
    const route = routeFromNotification(notification);
    if (route) {
      router.push(hrefFromRoute(route));
    }
  };

  useEffect(() => {
    if (!user || !employeeProfileReady) return;

    let cancelled = false;

    (async () => {
      const result = await registerPushNotifications({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
      });
      if (!cancelled) {
        onStatusChange?.(result.status);
        if (result.status === 'denied') {
          Alert.alert(
            'Notificaciones',
            'Para recibir alertas operativas, activá notificaciones de COSP Guardia en Ajustes del teléfono.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, empDocId, employee?.empresaId, employeeProfileReady, db, onStatusChange]);

  useEffect(() => {
    if (!user) return;

    if (!handledColdStartRef.current) {
      handledColdStartRef.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response?.notification) {
          openFromNotification(response.notification);
        }
      });
    }

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const title = notification.request.content.title ?? 'CronoApp';
      const body = notification.request.content.body ?? '';
      const dedupeKey = `${title}|${body}`;
      if (lastForegroundToastRef.current === dedupeKey) return;
      lastForegroundToastRef.current = dedupeKey;
      if (AppState.currentState === 'active') {
        const route = routeFromNotification(notification);
        if (route) {
          Alert.alert(title, body || 'Nueva notificación', [
            { text: 'Después', style: 'cancel' },
            { text: 'Abrir', onPress: () => router.push(hrefFromRoute(route)) },
          ]);
        } else {
          Alert.alert(title, body || 'Nueva notificación');
        }
      }
    });

    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      lastForegroundToastRef.current = null;
      if (event.notification) {
        openFromNotification(event.notification);
      }
    });

    return () => {
      received.remove();
      response.remove();
    };
  }, [user?.uid, router]);

  useEffect(() => {
    if (!user || !employeeProfileReady) return;

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      registerPushNotifications({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
      }).then((r) => onStatusChange?.(r.status));
    });

    return () => sub.remove();
  }, [user, empDocId, employee?.empresaId, employeeProfileReady, db, onStatusChange]);

  useEffect(() => {
    if (!user) return;
    getStoredFcmToken().then((token) => {
      if (token) onStatusChange?.('enabled');
    });
  }, [user?.uid, onStatusChange]);

  return null;
}
