/**
 * Email suppression list — checked before every Resend send so we don't
 * keep hammering addresses that have already bounced or marked us as spam.
 *
 * Why this matters at scale: shared-IP deliverability reputation is
 * cumulative. Two or three bounces a week, indefinitely, gradually pushes
 * our Resend account into the "marginal sender" bucket where Gmail/Outlook
 * start spam-foldering legitimate Sollos email for everyone. Suppression
 * is the cheapest mitigation that compounds in our favor.
 *
 * Population: by the Resend webhook handler (/api/webhooks/resend) on
 * email.bounced and email.complained events. Manual rows can be added
 * with reason='manual' for ad-hoc cases (refusing to email someone, etc).
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Returns true if the address is on the suppression list.
 * Case-insensitive — matches what we lowercase at insert time.
 *
 * Service-role read (the table is RLS-locked from anon/authenticated).
 * Failures here should NOT block sending — if Supabase is unreachable we
 * log and pretend the address is fine, since blocking every send on a
 * single dependency outage would be worse than letting one or two
 * suppressed-but-undetected emails through.
 */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  try {
    const admin = createSupabaseAdminClient();
    const { data } = (await admin
      .from("email_suppressions" as never)
      .select("id")
      .eq("email" as never, normalized as never)
      .maybeSingle()) as unknown as { data: { id: string } | null };
    return data !== null;
  } catch (err) {
    console.warn(
      "[email-suppression] check failed, allowing send:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Upsert a suppression row. Used by the Resend webhook handler — also
 * exposed for a future "manually suppress this client" admin button.
 *
 * On conflict (same email), reason + event_payload are updated to the
 * latest event. provider_event_id has its own unique index so a redelivered
 * webhook with the same event id is a true no-op (handled at insert time).
 */
export async function addEmailSuppression(args: {
  email: string;
  reason: "bounced" | "complained" | "manual";
  providerEventId?: string | null;
  eventPayload?: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = args.email.trim().toLowerCase();
  if (!normalized) return { ok: false, error: "Empty email" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("email_suppressions" as never).upsert(
    {
      email: normalized,
      reason: args.reason,
      provider_event_id: args.providerEventId ?? null,
      event_payload: args.eventPayload ?? null,
    } as never,
    { onConflict: "email" } as never,
  );

  if (error) {
    // 23505 unique_violation on provider_event_id is the idempotency
    // path — we already processed this event. Treat as success.
    const code = (error as { code?: string }).code;
    if (code === "23505") return { ok: true };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
