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

  const { title, body, href, icon } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "Sollos 3", {
      body: body || "",
      icon: icon || "/icon-192.png",
      badge: "/icon-192.png",
      tag: href || "default",   // Collapse duplicates for the same page
      renotify: true,
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
