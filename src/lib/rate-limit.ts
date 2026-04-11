/**
 * Simple in-memory sliding-window rate limiter.
 *
 * This is fine for a single Vercel serverless instance. In production with
 * many concurrent functions, you'd swap this for Upstash Redis — but for
 * the current traffic level this prevents abuse without adding a dependency.
 *
 * Each key (typically org ID) gets a window of `windowMs` milliseconds and
 * is allowed `maxRequests` in that window.
 */

import "server-only";

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

// Clean up stale entries every 60 seconds so memory doesn't grow unbounded
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

/**
 * Check whether a request should be allowed.
 *
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`
 */
export function checkRateLimit(
  key: string,
  maxRequests = 120,
  windowMs = 60_000,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  maybeCleanup();

  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + windowMs };
    store.set(key, entry);
    return { allowed: true };
  }

  entry.count += 1;
  if (entry.count > maxRequests) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true };
}
