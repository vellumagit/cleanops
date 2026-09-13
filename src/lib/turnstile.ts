import "server-only";

/**
 * Cloudflare Turnstile, server side.
 *
 * The widget on the signup form yields a single-use token that expires in
 * minutes; this is the only place it means anything. Two rules:
 *   - not configured (no secret) → the layer is off, signup works as before
 *   - configured but no token, or Cloudflare says no → refuse; a script that
 *     skipped the widget is exactly what this exists for
 *   - Cloudflare unreachable → allow and log; their outage is not a
 *     cleaner's problem, and the daily caps and tripwire sit behind this
 */

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export const TURNSTILE_FIELD = "cf-turnstile-response";

export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip && ip !== "unknown" ? { remoteip: ip } : {}),
      }),
    });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success !== true) {
      console.warn("[turnstile] refused:", (data["error-codes"] ?? []).join(","));
    }
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] siteverify unreachable — allowing:", err);
    return true;
  }
}
