/* CinemaTracker service worker.
 *
 * Intentionally PUSH-ONLY: it has NO `fetch` handler, so it never caches or
 * serves your HTML/CSS/JS. That keeps the app always-fresh (no "hard refresh to
 * see my change" problems) — its only job is to receive push notifications and
 * show them, which requires a service worker even when the app is closed.
 */

self.addEventListener('install', () => {
  // Activate this worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A push arrived from the server. Show it as a notification.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: 'CinemaTracker', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'CinemaTracker';
  const options = {
    body: data.body || '',
    icon: data.icon || 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    data: { url: data.url || './' },
    tag: data.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification focuses an open tab or opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) { try { await client.focus(); } catch (_) {} return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
