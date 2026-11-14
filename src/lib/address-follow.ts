import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasNoAddress, samePlace } from "@/lib/address-match";

/**
 * When a client's (or a property's) address changes, the visits already
 * booked for it change with it.
 *
 * Every booking keeps its own copy of the address, made the day it was
 * booked, and that copy is what the cleaner's phone and the calendar show
 * (jobAddress in client-properties.ts: the booking's copy wins). That is
 * right for a job that has happened: it records where the work was done.
 * For a job that has not happened it was a trap. Changing the address on
 * the client updated the client and nothing else, so the visit still sent
 * the crew to the old place. Svitlana changed Hilda Daubner's address on
 * 2026-11-13 and found the visit still pointing at the old one the next
 * day; 51 visits for another client changed the same day were the same.
 * A crew sent to the wrong address is paid for a job nobody did.
 *
 * What moves: visits still to come (pending or confirmed, not started)
 * whose own address is the OLD one, however it was written, and the
 * recurring series that would copy it onto new visits. What does not: a
 * visit with a different address typed on it on purpose, anything already
 * started or finished, and (for a client-level change) a visit tied to one
 * of the client's properties, which follows that property instead.
 */
export type AddressFollowResult = {
  /** Upcoming visits moved to the new address. */
  visitIds: string[];
  /** Recurring series templates moved. */
  seriesMoved: number;
  /** Upcoming visits left alone because a different address was typed on them. */
  leftAlone: number;
};

export async function moveUpcomingVisitsToAddress(
  admin: SupabaseClient,
  opts: {
    organizationId: string;
    clientId: string;
    /** Set when a property's address changed; null for the client's own. */
    propertyId: string | null;
    oldAddress: string | null;
    newAddress: string | null;
  },
): Promise<AddressFollowResult> {
  const result: AddressFollowResult = { visitIds: [], seriesMoved: 0, leftAlone: 0 };
  const { organizationId, clientId, propertyId, oldAddress, newAddress } = opts;
  // Nothing to move to, or nothing actually changed.
  if (hasNoAddress(newAddress)) return result;
  if ((oldAddress ?? "").trim() === (newAddress ?? "").trim()) return result;

  // property_id is in the row and filtered here rather than in the query:
  // "is null" and "equals" are different PostgREST calls, and one read
  // serves both.
  const mine = (row: { property_id: string | null }) =>
    propertyId ? row.property_id === propertyId : row.property_id == null;
  // The visit's own copy is the old address (written any way), so it moves.
  // Blank copies follow the client live already. Anything else was typed on
  // purpose.
  const follows = (address: string | null) => !hasNoAddress(address) && samePlace(address, oldAddress);

  const { data: visits, error: visitsErr } = (await admin
    .from("bookings")
    .select("id, address, property_id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", new Date().toISOString())
    .limit(2000)) as unknown as {
    data: Array<{ id: string; address: string | null; property_id: string | null }> | null;
    error: { message: string } | null;
  };
  if (visitsErr) throw new Error(visitsErr.message);
  const candidates = (visits ?? []).filter(mine);
  const toMove = candidates.filter((v) => follows(v.address)).map((v) => v.id);
  result.leftAlone = candidates.filter((v) => !hasNoAddress(v.address) && !follows(v.address)).length;

  for (let i = 0; i < toMove.length; i += 150) {
    const chunk = toMove.slice(i, i + 150);
    const { error } = (await admin
      .from("bookings")
      .update({ address: newAddress } as never)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .in("id", chunk)) as unknown as { error: { message: string } | null };
    if (error) throw new Error(error.message);
    result.visitIds.push(...chunk);
  }

  // The templates new visits are copied from, or tomorrow's batch comes out
  // with the old address again.
  const { data: series, error: seriesErr } = (await admin
    .from("booking_series")
    .select("id, address, property_id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .limit(500)) as unknown as {
    data: Array<{ id: string; address: string | null; property_id: string | null }> | null;
    error: { message: string } | null;
  };
  if (seriesErr) throw new Error(seriesErr.message);
  const seriesIds = (series ?? []).filter(mine).filter((s) => follows(s.address)).map((s) => s.id);
  if (seriesIds.length > 0) {
    const { error } = (await admin
      .from("booking_series")
      .update({ address: newAddress } as never)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .in("id", seriesIds)) as unknown as { error: { message: string } | null };
    if (error) throw new Error(error.message);
    result.seriesMoved = seriesIds.length;
  }

  return result;
}
