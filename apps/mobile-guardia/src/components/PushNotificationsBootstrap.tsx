import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { usePortalAuth } from '../context/PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';
import {
  getStoredFcmToken,
  registerPushNotifications,
  type PushRegistrationStatus,
} from '../lib/pushNotifications';

type PushNotificationsBootstrapProps = {
  onStatusChange?: (status: PushRegistrationStatus) => void;
};

export function PushNotificationsBootstrap({ onStatusChange }: PushNotificationsBootstrapProps) {
  const { user, empDocId, employee, employeeProfileReady } = usePortalAuth();
  const { db } = getPortalFirebase();
  const lastForegroundToastRef = useRef<string | null>(null);

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

    const received = Notifications.addNotificationReceivedListener((notification) => {
      const title = notification.request.content.title ?? 'CronoApp';
      const body = notification.request.content.body ?? '';
      const dedupeKey = `${title}|${body}`;
      if (lastForegroundToastRef.current === dedupeKey) return;
      lastForegroundToastRef.current = dedupeKey;
      if (AppState.currentState === 'active') {
        Alert.alert(title, body || 'Nueva notificación');
      }
    });

    const response = Notifications.addNotificationResponseReceivedListener(() => {
      lastForegroundToastRef.current = null;
    });

    return () => {
      received.remove();
      response.remove();
    };
  }, [user?.uid]);

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
