import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Opt a client out of the Google-review email track by their
 * `gbp_unsubscribe_token`. Shared by the human unsubscribe page
 * (GET /u/g/<token>) and the one-click List-Unsubscribe POST endpoint
 * (POST /api/u/g/<token>) so both stay in sync.
 *
 * Idempotent: a second call on an already-unsubscribed client is a no-op
 * success. Scoped to the review track only — booking confirmations, receipts,
 * and reminders still send.
 */
export async function unsubscribeGbpByToken(
  token: string,
): Promise<{ ok: boolean; orgName: string | null; already: boolean }> {
  if (!token || token.length < 8 || token.length > 64) {
    return { ok: false, orgName: null, already: false };
  }

  const admin = createSupabaseAdminClient();
  const { data: client } = (await admin
    .from("clients")
    .select(
      "id, gbp_unsubscribed_at, gbp_review_state, organization:organizations ( name )",
    )
    .eq("gbp_unsubscribe_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      gbp_unsubscribed_at: string | null;
      gbp_review_state: string;
      organization: { name: string } | null;
    } | null;
  };

  if (!client) return { ok: false, orgName: null, already: false };

  const orgName = client.organization?.name ?? null;
  if (client.gbp_unsubscribed_at) {
    return { ok: true, orgName, already: true };
  }

  // Only downgrade non-terminal states — leave clicked/reviewed alone.
  const shouldFlipState = ["never_asked", "pending"].includes(
    client.gbp_review_state,
  );
  await admin
    .from("clients")
    .update({
      gbp_unsubscribed_at: new Date().toISOString(),
      ...(shouldFlipState ? { gbp_review_state: "opted_out" } : {}),
    } as never)
    .eq("id", client.id);

  return { ok: true, orgName, already: false };
}
