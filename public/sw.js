/**
 * Sollos 3 service worker.
 *
 * Keeps things simple — cache the app shell for offline resilience and
 * let the network handle everything else. No complex caching strategies
 * needed at this stage; the main goal is to make the PWA installable
 * and give a basic offline fallback.
 */

const CACHE_NAME = "sollos-v1";
const SHELL_ASSETS = ["/sollos-logo.png"];

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

self.addEventListener("fetch", (event) => {
  // Only cache GET requests for same-origin assets
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML pages, cache-first for static assets
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
