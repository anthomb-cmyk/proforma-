// SOCLE ACQUISITIONS service worker.
//
// Responsibilities:
//   1. Minimal offline shell — cache the app HTML so a reload works on flaky
//      networks. Full offline isn't the goal; we just want the app to boot.
//   2. Handle Web Push `push` events → show a system notification.
//   3. Handle `notificationclick` → focus the existing tab or open the app.
//
// Bump CACHE_VERSION any time the cached asset list changes. The activate
// handler deletes old caches so users don't get stuck on stale shells.

const CACHE_VERSION = "socle-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for navigation, cache fallback. Everything else passes
// through — we don't want to cache the JS/CSS bundles because react-scripts
// fingerprints them and stale cache = broken app.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only intercept same-origin navigation requests.
  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
  }
});

// ─── Web Push ──────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "SOCLE", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "SOCLE Acquisitions";
  const body  = payload.body  || "";
  const url   = payload.url   || "/";
  const tag   = payload.tag   || "socle-notice";
  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    data: { url },
    renotify: !!payload.renotify,
    requireInteraction: !!payload.requireInteraction,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        // Prefer an existing tab if there is one — less jarring than opening a new one.
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return null;
    })
  );
});
