import "server-only";

import { randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The client's private link to one visit: /v/<token>.
 *
 * The easiest door for a client is the message they already have. Every
 * booking email carries one button that opens that exact visit, with no
 * sign-in (docs/online-booking-roadmap.md, "How a client gets in"). Holding
 * the link is the permission, the way it is for an invoice or an estimate,
 * and it opens that one visit and nothing else.
 *
 * The link stops working a week after the visit: by then there is nothing
 * left to change, and an old email in someone's inbox shouldn't open a page
 * forever.
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com").replace(/\/$/, "");

/** How long after the visit its link still opens. */
export const VISIT_LINK_DAYS_AFTER = 7;

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * The link for this visit, made if it has none. Null when it can't be made
 * (the visit is gone, or the column isn't there yet): the caller then sends
 * its message without the button, which is how every message went before.
 */
export async function visitLinkFor(bookingId: string, admin: Admin = createSupabaseAdminClient()): Promise<string | null> {
  try {
    const { data: row, error } = (await admin
      .from("bookings")
      .select("manage_token" as never)
      .eq("id", bookingId)
      .maybeSingle()) as unknown as { data: { manage_token: string | null } | null; error: { message: string } | null };
    if (error || !row) return null;
    if (row.manage_token) return `${siteUrl()}/v/${row.manage_token}`;

    const token = randomBytes(18).toString("base64url");
    // Only where there is none: two messages sent at once must end up with
    // the same link, not one that was overwritten after it went out.
    const { data: set } = (await admin
      .from("bookings")
      .update({ manage_token: token } as never)
      .eq("id", bookingId)
      .is("manage_token" as never, null)
      .select("manage_token" as never)) as unknown as { data: Array<{ manage_token: string }> | null };
    if (set?.length) return `${siteUrl()}/v/${set[0].manage_token}`;

    const { data: again } = (await admin
      .from("bookings")
      .select("manage_token" as never)
      .eq("id", bookingId)
      .maybeSingle()) as unknown as { data: { manage_token: string | null } | null };
    return again?.manage_token ? `${siteUrl()}/v/${again.manage_token}` : null;
  } catch (err) {
    console.error("[visit-link] could not make a link:", err);
    return null;
  }
}

export type LinkedVisit = {
  id: string;
  organization_id: string;
  client_id: string;
  series_id: string | null;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  archived_at: string | null;
  assigned_to: string | null;
  address: string | null;
  service_type_label: string | null;
  service_type: string;
  client: { id: string; name: string; archived_at: string | null };
};

/**
 * The visit behind a link, or null: a token that isn't one, a visit that is
 * gone, a client who has been archived, or a link more than a week past its
 * visit.
 */
export async function visitByToken(token: string, admin: Admin = createSupabaseAdminClient()): Promise<LinkedVisit | null> {
  if (!TOKEN.test(token ?? "")) return null;
  const { data, error } = (await admin
    .from("bookings")
    .select(
      "id, organization_id, client_id, series_id, scheduled_at, duration_minutes, status, archived_at, assigned_to, address, service_type_label, service_type, client:clients ( id, name, archived_at )" as never,
    )
    .eq("manage_token" as never, token as never)
    .maybeSingle()) as unknown as { data: LinkedVisit | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (!data || !data.client || data.client.archived_at) return null;
  const until = new Date(data.scheduled_at).getTime() + VISIT_LINK_DAYS_AFTER * 86_400_000;
  if (!Number.isFinite(until) || Date.now() > until) return null;
  return data;
}
