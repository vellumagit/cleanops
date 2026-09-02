/**
 * Sollos 3 service worker.
 *
 * 1. PWA offline resilience — cache app shell, network-first for pages.
 * 2. Web Push — receive push events and show system notifications.
 */

const CACHE_NAME = "sollos-v2";
const SHELL_ASSETS = ["/sollos-logo.png", "/icon-192.png"];

// ─────────────────────────────────────────────────────────────────
// Install & Activate — cache app shell, clean up old caches
// ─────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// ─────────────────────────────────────────────────────────────────
// Fetch — network-first for HTML, cache-first for assets
// ─────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then(
          (cached) =>
            cached ||
            new Response(
              "<html><body style='font-family:system-ui;text-align:center;padding:4rem 1rem'>" +
                "<h1>You're offline</h1>" +
                "<p>Check your connection and try again.</p></body></html>",
              { headers: { "Content-Type": "text/html" } },
            ),
        ),
      ),
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(
        (cached) => cached || fetch(event.request),
      ),
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// Push — receive notifications from the server
// ─────────────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Sollos 3",
      body: event.data.text(),
      href: "/",
      icon: "/icon-192.png",
    };
  }

  const { title, body, href, icon, sticky, quiet, tag, dismiss } = payload;

  // RETRACTION. A sticky notification stays in the shade until someone
  // dismisses it — which is right for "you're still on the clock", and wrong
  // the moment they actually clock out. Nothing used to take it back, so the
  // phone kept saying "tap to clock out" to someone who already had, and
  // tapping it again changed nothing. A push carrying { dismiss: true }
  // closes the matching notification instead of showing another.
  if (dismiss) {
    event.waitUntil(
      self.registration
        .getNotifications({ tag: tag || href || "default" })
        .then((existing) => existing.forEach((n) => n.close())),
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title || "Sollos 3", {
      body: body || "",
      icon: icon || "/icon-192.png",
      badge: "/icon-192.png",
      // An explicit tag lets a series of updates REPLACE each other rather
      // than stack — e.g. a clock-out reminder that rewrites itself with the
      // running total instead of leaving six notifications in the shade.
      tag: tag || href || "default",
      // sticky: stay in the shade until deliberately dismissed. This is the
      // closest the web gets to an ongoing/foreground notification. Android
      // honours it; iOS ignores it (no requireInteraction support there).
      requireInteraction: Boolean(sticky),
      // quiet: update in place without buzzing again. Re-alerting every 30
      // minutes is how a useful nudge becomes something people mute.
      silent: Boolean(quiet),
      renotify: !quiet,
      data: { href: href || "/" },
    }),
  );
});

// ─────────────────────────────────────────────────────────────────
// Notification click — open or focus the relevant page
// ─────────────────────────────────────────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const href = event.notification.data?.href || "/";
  const urlToOpen = new URL(href, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // If a window is already open on the same path, focus it
      for (const client of clients) {
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(urlToOpen);
    }),
  );
});
