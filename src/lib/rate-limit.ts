/**
 * Sliding-window rate limiter backed by Upstash Redis.
 *
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your Vercel
 * environment to enable distributed rate limiting across all serverless
 * instances.  If those vars are missing the limiter falls back to a
 * per-instance in-memory map — still useful for local dev.
 */

import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/* ─── Redis-backed limiter (production) ─────────────────────── */

let redisLimiter: Ratelimit | null = null;

function getRedisLimiter(): Ratelimit | null {
  if (redisLimiter) return redisLimiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redisLimiter = new Ratelimit({
    redis: new Redis({ url, token }),
    // 120 requests per 60-second sliding window, per key
    limiter: Ratelimit.slidingWindow(120, "60 s"),
    analytics: true,
    prefix: "cleanops:rl",
  });

  return redisLimiter;
}

/* ─── In-memory fallback (dev / no Redis configured) ────────── */

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

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

function memoryLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
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

/* ─── Public API ────────────────────────────────────────────── */

/**
 * Check whether a request should be allowed.
 *
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`
 */
export async function checkRateLimit(
  key: string,
  maxRequests = 120,
  windowMs = 60_000,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const redis = getRedisLimiter();

  if (redis) {
    try {
      const result = await redis.limit(key);
      if (result.success) return { allowed: true };
      const retryAfterSeconds = Math.ceil(
        Math.max(result.reset - Date.now(), 1000) / 1000,
      );
      return { allowed: false, retryAfterSeconds };
    } catch (err) {
      // Redis is down — fall through to in-memory so the API stays up
      console.warn("[rate-limit] Redis error, falling back to memory:", err);
    }
  }

  return memoryLimit(key, maxRequests, windowMs);
}
