import { useEffect } from 'react';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, app } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

export function useAdminFcm() {
  const { user, isAdmin } = useAuth();
  const { empresaId } = useEmpresa();

  useEffect(() => {
    if (!user || !isAdmin) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) return;

    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const { getMessaging, getToken, onMessage } = await import('firebase/messaging');
        const messaging = getMessaging(app);
        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
        if (!token || cancelled) return;

        const oldToken = localStorage.getItem('fcm_admin_token');
        if (oldToken && oldToken !== token) {
          try { await deleteDoc(doc(db, 'device_tokens', oldToken)); } catch (_) {}
        }

        await setDoc(doc(db, 'device_tokens', token), {
          uid: user.uid,
          token,
          empresaId: empresaId || null,
          role: 'admin',
          platform: 'web',
          updatedAt: serverTimestamp(),
        }, { merge: true });

        localStorage.setItem('fcm_admin_token', token);

        // Foreground: mostrar notificación del sistema cuando la app está abierta
        const unsub = onMessage(messaging, (payload) => {
          if (cancelled) return;
          const title = payload?.data?.title || payload?.notification?.title || 'COSP';
          const body  = payload?.data?.body  || payload?.notification?.body  || '';
          const link  = payload?.data?.link  || '/admin/operaciones';
          try {
            if (Notification.permission === 'granted') {
              const n = new Notification(title, { body, icon: '/icons/icon-192x192.png' });
              n.onclick = () => { window.location.href = link; };
            }
          } catch (_) {}
        });

        return () => { unsub(); };
      } catch (e) {
        console.warn('[useAdminFcm]', e);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.uid, isAdmin, empresaId]);
}
