/**
 * Single-use CSRF state tokens for OAuth handshakes (Sage, QuickBooks).
 *
 * Both providers mint a random token at connect time, tied to (org, membership)
 * with a 10-minute TTL, and consume it when the provider calls us back.
 *
 * Consumption MARKS the row (consumed_at) rather than deleting it. A callback
 * URL can legitimately be requested more than once in a single flow — browser
 * or extension prefetch, a refresh, back-navigation — and once the row is gone
 * the second request is indistinguishable from a forged one. The user then
 * lands on an error page for a connection that actually succeeded, which is
 * exactly what happened to the first real Sage connect on 2026-07-29.
 *
 * Retaining the row lets the caller tell "our own state, already used" apart
 * from "never issued this", and report the truth without re-exchanging the
 * authorization code (which the provider would reject anyway — codes are
 * single-use too).
 *
 * Rows are pruned by the daily cleanup cron.
 */

import "server-only";
import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type OAuthStateTable = "sage_oauth_states" | "quickbooks_oauth_states";

export type OAuthStateOutcome =
  /** Fresh and valid — proceed with the token exchange. */
  | { status: "ok"; organizationId: string; membershipId: string }
  /** Our own state, already used. An earlier callback did the work. */
  | { status: "replayed"; organizationId: string; membershipId: string }
  /** Never issued by us, or already pruned. */
  | { status: "unknown" }
  /** Issued by us, but the consent screen took longer than the TTL. */
  | { status: "expired" };

/**
 * Decide what a stored state row means, before we try to claim it.
 *
 * Pure so the ordering can be tested directly — it is the whole point of this
 * module and easy to get backwards.
 */
export function classifyOAuthState(
  row: { expires_at: string; consumed_at: string | null },
  now: Date = new Date(),
): "replayed" | "expired" | "claimable" {
  // Replay is checked BEFORE expiry on purpose: a duplicate callback arriving
  // after the 10-minute TTL is still a replay of a handshake that succeeded,
  // not a stale attempt worth telling the user to retry. Checking expiry first
  // would send someone whose connection worked back to "please try again".
  if (row.consumed_at) return "replayed";
  if (new Date(row.expires_at) < now) return "expired";
  return "claimable";
}

/**
 * Mint a state token for an OAuth handshake.
 *
 * Throws if the row can't be persisted. The previous version discarded the
 * insert error, so a DB failure sent the user off to the provider with a state
 * that could never validate — surfacing as "invalid session" minutes later,
 * with nothing in the logs to explain it. Failing here, before we hand the
 * browser off, puts the error where it can be read.
 */
export async function issueOAuthState(
  table: OAuthStateTable,
  args: { organizationId: string; membershipId: string },
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const admin = createSupabaseAdminClient();

  const { error } = await admin.from(table as never).insert({
    state,
    organization_id: args.organizationId,
    membership_id: args.membershipId,
  } as never);

  if (error) {
    throw new Error(
      `Could not persist OAuth state in ${table}: ${error.message}`,
    );
  }

  return state;
}

/**
 * Look up and claim a state token.
 *
 * Never throws for an unrecognised state — that's a normal (if suspicious)
 * outcome the caller reports to the user. It DOES throw when the database
 * itself fails, so callers can distinguish "this callback is bogus" from
 * "we couldn't check", which deserve different messages.
 */
export async function consumeOAuthState(
  table: OAuthStateTable,
  state: string,
): Promise<OAuthStateOutcome> {
  const admin = createSupabaseAdminClient();

  const { data, error } = (await admin
    .from(table as never)
    .select("organization_id, membership_id, expires_at, consumed_at")
    .eq("state" as never, state as never)
    .maybeSingle()) as unknown as {
    data: {
      organization_id: string;
      membership_id: string;
      expires_at: string;
      consumed_at: string | null;
    } | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(
      `Could not read OAuth state from ${table}: ${error.message}`,
    );
  }
  if (!data) return { status: "unknown" };

  const identity = {
    organizationId: data.organization_id,
    membershipId: data.membership_id,
  };

  const classification = classifyOAuthState(data);
  if (classification === "replayed") return { status: "replayed", ...identity };
  if (classification === "expired") return { status: "expired" };

  // Claim it. Conditioned on consumed_at IS NULL so that two callbacks racing
  // in parallel can't both win — the loser updates zero rows and is told it's
  // a replay. The old delete-based version had no equivalent guard.
  const { data: claimed, error: claimErr } = (await admin
    .from(table as never)
    .update({ consumed_at: new Date().toISOString() } as never)
    .eq("state" as never, state as never)
    .is("consumed_at" as never, null)
    .select("state")) as unknown as {
    data: Array<{ state: string }> | null;
    error: { message: string } | null;
  };

  if (claimErr) {
    throw new Error(
      `Could not consume OAuth state in ${table}: ${claimErr.message}`,
    );
  }
  if (!claimed || claimed.length === 0) {
    return { status: "replayed", ...identity };
  }

  return { status: "ok", ...identity };
}
