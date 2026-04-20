/**
 * Ergonomic wrappers around `checkRateLimit` for the two shapes of code
 * that need to apply it:
 *
 *   - **API route handlers** — call `rateLimitByIp(request, bucket, max, windowMs)`.
 *     Returns a 429 Response to be returned directly if the IP is over budget,
 *     or null if the call may proceed.
 *
 *   - **Server components + server actions** — use `checkIpRateLimit(bucket, max, windowMs)`.
 *     Reads the client IP from `next/headers()` (no request arg available in
 *     RSC land). Returns the allow/deny result; caller decides what to render.
 *
 * Bucket conventions: a short prefix that groups related endpoints so abuse
 * in one namespace doesn't exhaust another (e.g. "inv-token", "claim-token",
 * "auth", "stripe-webhook").
 */

import "server-only";
import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";

function getIp(h: { get(name: string): string | null }): string {
  // Vercel sets x-forwarded-for as "client, proxy1, proxy2, ..." — first is the real one.
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * API-route variant. Call at the top of an API route handler. Returns a 429
 * Response when the limit is exceeded, so the caller can `return` it verbatim;
 * otherwise returns `null` and the request may proceed.
 *
 * ```ts
 * export async function POST(req: Request) {
 *   const limited = await rateLimitByIp(req, "verify-sender", 10, 60_000);
 *   if (limited) return limited;
 *   // ...
 * }
 * ```
 */
export async function rateLimitByIp(
  request: Request,
  bucket: string,
  max: number,
  windowMs: number,
): Promise<Response | null> {
  const ip = getIp(request.headers);
  const result = await checkRateLimit(`${bucket}:${ip}`, max, windowMs);
  if (result.allowed) return null;

  return new Response(
    JSON.stringify({
      error: "Too many requests",
      retryAfterSeconds: result.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

/**
 * RSC / server action variant. No `Request` object is available — we read the
 * IP from `next/headers()`. Caller decides whether to render an error page,
 * redirect, or throw `notFound()`.
 */
export async function checkIpRateLimit(
  bucket: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const h = await headers();
  const ip = getIp(h);
  return checkRateLimit(`${bucket}:${ip}`, max, windowMs);
}
