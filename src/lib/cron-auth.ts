import "server-only";

/**
 * Cron endpoint auth guard.
 *
 * Vercel Cron sends the header `Authorization: Bearer <CRON_SECRET>` when
 * invoking endpoints listed in vercel.json. Any other caller that wants to
 * trigger one (local testing, a backup orchestrator, etc.) must provide the
 * same header.
 *
 * Critical: this function **fails closed** — if `CRON_SECRET` is unset in
 * the environment, every request is rejected. The previous inline check
 * (`if (cronSecret && ...)`) had inverted logic and left every cron route
 * publicly accessible when the env var was missing or empty.
 */
export function requireCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 16) {
    // Missing or trivially-weak secret — refuse everything. This surfaces
    // misconfiguration loudly instead of silently opening the door.
    return Response.json(
      { error: "Cron auth is not configured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // authorized — caller continues
}
