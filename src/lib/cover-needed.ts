import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { memberDisplayName } from "@/lib/member-display";
import type { CoverVisit } from "@/lib/cover-needed-text";

/**
 * Visits marked as needing cover (bookings.cover_needed, written by the
 * series crew save in migration 20261119040000), with the names a person
 * needs to act on them. Cancelled and completed visits are left out: there
 * is nothing left to cover.
 *
 * Reads with the admin client and always scopes to the organization given.
 */
export async function loadCoverNeeded(
  organizationId: string,
  filter: { bookingIds?: string[]; seriesId?: string; from?: string; to?: string; limit?: number },
): Promise<CoverVisit[]> {
  if (filter.bookingIds && filter.bookingIds.length === 0) return [];
  const admin = createSupabaseAdminClient();

  type Row = {
    id: string;
    scheduled_at: string;
    cover_needed: Array<{ membership_id?: string; other_booking_id?: string }> | null;
    client: { name: string | null } | null;
  };
  const rows: Row[] = [];
  const ids = filter.bookingIds;
  // In slices: a long series' ids would not fit in one request address.
  for (let i = 0; i < (ids ? ids.length : 1); i += 150) {
    let query = admin
      .from("bookings")
      .select("id, scheduled_at, cover_needed, client:clients ( name )" as never)
      .eq("organization_id", organizationId)
      .not("cover_needed" as never, "is", null)
      .not("status", "in", '("cancelled","completed")')
      .order("scheduled_at", { ascending: true })
      .limit(filter.limit ?? 500);
    if (ids) query = query.in("id", ids.slice(i, i + 150));
    if (filter.seriesId) query = query.eq("series_id" as never, filter.seriesId as never);
    if (filter.from) query = query.gte("scheduled_at", filter.from);
    if (filter.to) query = query.lt("scheduled_at", filter.to);
    const { data, error } = (await query) as unknown as { data: Row[] | null; error: { message: string } | null };
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  if (rows.length === 0) return [];

  const memberIds = new Set<string>();
  const otherIds = new Set<string>();
  for (const r of rows) {
    for (const c of r.cover_needed ?? []) {
      if (c.membership_id) memberIds.add(c.membership_id);
      if (c.other_booking_id) otherIds.add(c.other_booking_id);
    }
  }

  const names = new Map<string, string>();
  if (memberIds.size > 0) {
    const { data } = (await admin
      .from("memberships")
      .select("id, display_name, profile:profiles ( full_name )")
      .eq("organization_id", organizationId)
      .in("id", [...memberIds])) as unknown as {
      data: Array<{ id: string; display_name: string | null; profile: { full_name: string | null } | null }> | null;
    };
    for (const m of data ?? []) names.set(m.id, memberDisplayName(m));
  }

  const others = new Map<string, { client: string | null; at: string }>();
  const otherList = [...otherIds];
  for (let i = 0; i < otherList.length; i += 150) {
    const { data } = (await admin
      .from("bookings")
      .select("id, scheduled_at, client:clients ( name )")
      .eq("organization_id", organizationId)
      .in("id", otherList.slice(i, i + 150))) as unknown as {
      data: Array<{ id: string; scheduled_at: string; client: { name: string | null } | null }> | null;
    };
    for (const b of data ?? []) others.set(b.id, { client: b.client?.name ?? null, at: b.scheduled_at });
  }

  return rows
    .map((r) => {
      // One line per person, even when two other jobs were in the way.
      const people = new Map<string, CoverVisit["people"][number]>();
      for (const c of r.cover_needed ?? []) {
        if (!c.membership_id || people.has(c.membership_id)) continue;
        const other = c.other_booking_id ? others.get(c.other_booking_id) : undefined;
        people.set(c.membership_id, {
          membershipId: c.membership_id,
          name: names.get(c.membership_id) ?? "A cleaner",
          otherClient: other?.client ?? null,
          otherAt: other?.at ?? null,
        });
      }
      return {
        bookingId: r.id,
        scheduledAt: r.scheduled_at,
        clientName: r.client?.name ?? "A client",
        people: [...people.values()],
      };
    })
    .filter((v) => v.people.length > 0)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** Who was left off each of these visits: booking id → membership ids. */
export function leftOffByBooking(visits: CoverVisit[]): Map<string, Set<string>> {
  return new Map(visits.map((v) => [v.bookingId, new Set(v.people.map((p) => p.membershipId))]));
}
