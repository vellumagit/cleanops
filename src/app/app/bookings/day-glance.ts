"use server";

import { getActionContext } from "@/lib/actions";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedMidnightUtc } from "@/lib/wall-clock";
import { memberDisplayName } from "@/lib/member-display";

/**
 * "What else is on that day?" — for the booking form's date field.
 *
 * Svitlana, booking on her phone: "I wanna book on a particular day. I can
 * see if I have something there." She couldn't. A datetime-local input on a
 * phone is a spinner — it names no weekday and shows nothing about the day
 * it is choosing, so picking a date meant leaving the form, checking the
 * schedule, and coming back holding the answer in her head.
 *
 * Deliberately small: the times, who is on them, and nothing else. This
 * answers "is that day busy, and is the slot I want free", not "show me the
 * schedule" — the scheduler already does that better.
 */

export type DayGlanceJob = {
  id: string;
  /** Minutes from org-local midnight — the client formats it. */
  startMinutes: number;
  durationMinutes: number;
  clientName: string;
  who: string | null;
  status: string;
};

export type DayGlanceResult =
  | { ok: true; jobs: DayGlanceJob[] }
  | { ok: false; error: string };

/** `dateYmd` is an org-local calendar day, "2026-09-16". */
export async function getDayGlanceAction(
  dateYmd: string,
): Promise<DayGlanceResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return { ok: false, error: "Pick a date first." };
  }

  try {
    const { membership, supabase } = await getActionContext();
    const tz = await getOrgTimezone(membership.organization_id);

    // Org-local day bounds, not bare timestamps — an 8 PM job on the chosen
    // day lives at 2 AM UTC the next day and would otherwise vanish from
    // its own date.
    const start = zonedMidnightUtc(dateYmd, tz);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const { data, error } = (await supabase
      .from("bookings")
      .select(
        "id, scheduled_at, duration_minutes, status, client:clients ( name ), assigned:memberships!bookings_assigned_to_fkey ( display_name, profile:profiles ( full_name ) )",
      )
      .eq("organization_id", membership.organization_id)
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .limit(50)) as unknown as {
      data: Array<{
        id: string;
        scheduled_at: string;
        duration_minutes: number | null;
        status: string;
        client: { name: string | null } | null;
        assigned: {
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      }> | null;
      error: { message: string } | null;
    };

    if (error) return { ok: false, error: error.message };

    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return {
      ok: true,
      jobs: (data ?? []).map((b) => {
        const parts = fmt.formatToParts(new Date(b.scheduled_at));
        const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
        const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
        return {
          id: b.id,
          startMinutes: h * 60 + m,
          durationMinutes: b.duration_minutes ?? 0,
          clientName: b.client?.name ?? "—",
          who: b.assigned ? memberDisplayName(b.assigned) : null,
          status: b.status,
        };
      }),
    };
  } catch {
    // Never break the form over a preview of the day.
    return { ok: false, error: "Couldn't load that day." };
  }
}
