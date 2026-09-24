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

/** Portal guardia web reemplazó /empleado → /app (mismo origen). */
function resolveNotificationLink(raw) {
  const link = (raw || '').trim() || '/app/';
  if (link.startsWith('/empleado')) {
    const qs = link.includes('?') ? link.slice(link.indexOf('?')) : '';
    return `/app/${qs}`;
  }
  return link;
}

// Data-only messages: we control the notification display
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'CronoApp';
  const body  = data.body  || '';
  const link  = resolveNotificationLink(data.link);
  const notificationId = data.notificationId || '';

  self.registration.showNotification(title, {
    body,
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-192.png',
    tag: notificationId || 'crono-notif',
    renotify: true,
    data: { link, notificationId, ...(data || {}) }
  });
});

// Mark as read when tapped: open app at the notification link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = resolveNotificationLink(event.notification.data?.link);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('comtroldata') && 'focus' in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
