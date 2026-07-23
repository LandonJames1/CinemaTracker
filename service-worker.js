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

const CACHE_VERSION = 'v141';
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
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Is the app already open + in the foreground on this device?
    const appFocused = clientsArr.some((c) => c.focused || c.visibilityState === 'visible');

    // Always tell any open page a push arrived so it refreshes its in-app badges
    // + the Activity sheet live (works even when the OS notification is suppressed
    // below, and covers users who received the event while actively in the app).
    for (const c of clientsArr) {
      try { c.postMessage({ type: 'PUSH_RECEIVED', url: data.url || '', badge: data.badge }); } catch (_) {}
    }

    // Only pop the intrusive OS notification when the app ISN'T focused here — if
    // the user is already in the app, the in-app bell/badges + sheet cover it.
    if (!appFocused) {
      await self.registration.showNotification(title, options);
    }

    // Update the home-screen icon badge immediately (even while the app is closed).
    if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
      try { data.badge > 0 ? await self.navigator.setAppBadge(data.badge) : await self.navigator.clearAppBadge?.(); } catch (_) {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Resolve relative to the app's scope (GitHub Pages serves under a subpath, so
  // an absolute "/..." would 404). Keep any #hash from the payload.
  const raw = String((event.notification.data && event.notification.data.url) || '');
  const hash = raw.includes('#') ? raw.slice(raw.indexOf('#')) : '';
  const targetUrl = self.registration.scope + hash;
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try { await client.focus(); } catch (_) {}
        // The app is already running (common on iOS): focusing won't re-run the
        // boot deep-link, so tell the page where to navigate (Feed / Recs). This
        // is what makes the in-app "mark seen" run and clear the badge.
        try { client.postMessage({ type: 'NOTIFICATION_NAV', url: raw }); } catch (_) {}
        return;
      }
    }
    // Cold start: open at the hash so the boot deep-link routes us there.
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
