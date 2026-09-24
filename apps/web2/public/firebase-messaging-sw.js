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
  const data = payload.data || {};
  const title = data.title || 'CronoApp';
  const body  = data.body  || '';
  const link  = data.link  || '/empleado/dashboard';
  const notificationId = data.notificationId || '';

  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: notificationId || 'crono-notif',
    renotify: true,
    data: { link, notificationId }
  });
});

// Mark as read when tapped: open app at the notification link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/empleado/dashboard';
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
