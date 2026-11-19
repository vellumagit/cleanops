import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { membersOffOn } from "@/lib/unavailability-notice";
import { memberDisplayName } from "@/lib/member-display";

/**
 * Is anyone on this crew off that day?
 *
 * Dragging a visit on the board already said so ("Moved, but Anna is off
 * that day"). The booking form said nothing: a visit could be saved onto a
 * cleaner's approved day off and sent to them to accept, and the office
 * found out when they declined or didn't turn up.
 *
 * The office may still mean it, so this is a question, not a refusal: the
 * first save comes back with the names and a key; saving again with that
 * key posted as `confirm_time_off` goes through. The key names the day and
 * the people, so changing either asks again.
 */
export async function awayCrewQuestion(input: {
  organizationId: string;
  crewIds: string[];
  /** The visit's day on the company's calendar, YYYY-MM-DD. */
  ymd: string;
  /** What the form posted as confirm_time_off. */
  confirmed: string;
}): Promise<{ message: string; key: string } | null> {
  const crew = [...new Set(input.crewIds.filter(Boolean))];
  if (crew.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.ymd)) return null;

  let off: string[];
  try {
    off = await membersOffOn(input.organizationId, crew, input.ymd);
  } catch (err) {
    // The check failing must not stop a booking being saved.
    console.error("[bookings] time-off check failed:", err);
    return null;
  }
  if (off.length === 0) return null;

  const key = `${input.ymd}:${[...off].sort().join(",")}`;
  if (input.confirmed === key) return null;

  const { data: people } = (await createSupabaseAdminClient()
    .from("memberships")
    .select("id, display_name, profile:profiles ( full_name )")
    .in("id", off)) as unknown as {
    data: Array<{
      id: string;
      display_name: string | null;
      profile: { full_name: string | null } | null;
    }> | null;
  };
  const names = (people ?? []).map((p) => memberDisplayName(p));
  const who = names.length > 0 ? names.join(" and ") : "Someone on this visit";
  const day = new Date(`${input.ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return {
    key,
    message: `${who} ${names.length > 1 ? "are" : "is"} off on ${day} (approved time off, or a day marked unavailable). Nothing was saved. Press Save again to book them anyway, or pick someone else.`,
  };
}
