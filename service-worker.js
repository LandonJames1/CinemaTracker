/* CinemaTracker service worker.
 *
 * Goals:
 *  1) Receive push notifications (needs a SW even when the app is closed).
 *  2) Make the installed PWA ALWAYS load the latest deploy — no reinstalling.
 *
 * Strategy: NETWORK-FIRST for our own files. Every load fetches fresh from the
 * network (bypassing the HTTP cache) so a new deploy shows up immediately; the
 * cache is only a fallback when the device is offline. Cross-origin requests
 * (Supabase, TMDB images, CDN scripts) are left untouched.
 *
 * Bump CACHE_VERSION on each deploy you want to force — changing this file's
 * bytes is what makes the browser install the new worker, which then tells any
 * open page to reload onto the new version.
 */

const CACHE_VERSION = 'v14';
const CACHE = `cinematracker-${CACHE_VERSION}`;

self.addEventListener('install', () => {
  // Take over as soon as the new worker is ready (don't wait for tabs to close).
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches from older versions.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Let any open page know a new version is live so it can reload itself.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only manage our own origin; let Supabase / TMDB / CDNs go straight to network.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // 'no-cache' = revalidate against the server, so we never serve a stale
      // HTTP-cached copy. This is what makes updates appear without a reinstall.
      const fresh = await fetch(req, { cache: 'no-cache' });
      try {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      } catch (_) {}
      return fresh;
    } catch (_) {
      // Offline — fall back to the last cached copy if we have one.
      const cached = await caches.match(req);
      return cached || Response.error();
    }
  })());
});

// ---- Push notifications -----------------------------------------------------
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
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Update the home-screen icon badge immediately (even while the app is closed).
    if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
      try { data.badge > 0 ? await self.navigator.setAppBadge(data.badge) : await self.navigator.clearAppBadge?.(); } catch (_) {}
    }
  })());
});

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
