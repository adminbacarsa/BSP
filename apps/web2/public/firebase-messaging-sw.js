importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBJaTiMekwbGPXAm-mkPl_u6KEWCSpvfic",
  authDomain: "comtroldata.firebaseapp.com",
  projectId: "comtroldata",
  storageBucket: "comtroldata.firebasestorage.app",
  messagingSenderId: "698108879063",
  appId: "1:698108879063:web:ab30eb8b80a774f52f1092"
});

const messaging = firebase.messaging();

// Data-only messages: we control the notification display
messaging.onBackgroundMessage((payload) => {
  // Con payload.notification el SDK ya muestra la notificación: mostrar otra duplica ("CronoApp" vacía).
  if (payload.notification) return;
  const data = payload.data || {};
  const title = data.title || 'CronoApp';
  const body  = data.body  || '';
  const link  = data.link  || '/app/';
  const notificationId = data.notificationId || '';

  const esOperador = String(data.click_action || '') === 'OPERACIONES_ALERT';

  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: notificationId || data.shiftId || 'crono-notif',
    renotify: true,
    // Operador (ausencia, no llegó, retenido, tope, convocatoria): queda hasta que lo toque y vibra.
    requireInteraction: esOperador,
    vibrate: esOperador ? [300, 120, 300] : undefined,
    data: { link, notificationId, shiftId: data.shiftId || '' }
  });
});

// Mark as read when tapped: open app at the notification link (deep-link ?shiftId= abre la tarjeta)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || (event.notification.data?.FCM_MSG?.data?.link) || '/app/';
  const target = new URL(link, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
