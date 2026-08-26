import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveShiftWindows, shiftWindowKey } from "@/lib/crew-hours";
import { memberDisplayName } from "@/lib/member-display";

/**
 * Cross-check what an invoice bills against what the crew actually logged.
 *
 * Svitlana's ask, verbatim: "if I send the right invoice for the right
 * amount of time and the girls worked the same amount of time, is it
 * possible to connect these?" The chain always existed — invoice → billed
 * bookings → time entries — it was just never drawn on one screen.
 *
 * Per billed job, every cleaner's logged minutes sit next to what THEY were
 * expected to work: their split-shift allotment when the job divides hours
 * (two cleaners on a 3h job owe 90 minutes each — comparing either against
 * the full 3h flags everyone forever), the booking's duration otherwise.
 * This also answers her team question for free: two cleaners on one job
 * render side by side, so unequal hours are visible without any extra
 * feature.
 *
 * Tolerance is deliberately loose (15 min): punches naturally wobble a few
 * minutes, and a check that cries wolf gets ignored by week two.
 */

export const HOURS_TOLERANCE_MINUTES = 15;

export type HoursCheckPerson = {
  membershipId: string;
  name: string;
  loggedMinutes: number;
  expectedMinutes: number | null;
  /** logged − expected; null when no expectation exists. */
  deltaMinutes: number | null;
  /** Still clocked in on this job — logged is a moving number. */
  hasOpenEntry: boolean;
  flagged: boolean;
};

export type HoursCheckJob = {
  bookingId: string;
  scheduledAt: string;
  serviceLabel: string | null;
  durationMinutes: number | null;
  people: HoursCheckPerson[];
  /** Completed job with zero logged time — its own kind of mismatch. */
  noHours: boolean;
  bookingStatus: string;
  flagged: boolean;
};

export type HoursCheck = {
  jobs: HoursCheckJob[];
  anyFlagged: boolean;
};

export async function invoiceHoursCheck(
  db: SupabaseClient,
  invoiceId: string,
): Promise<HoursCheck | null> {
  // Which bookings does this invoice bill? Per-job invoices stamp
  // invoices.booking_id; consolidated ones link line items.
  const [{ data: inv }, { data: liRows }] = await Promise.all([
    db
      .from("invoices")
      .select("booking_id")
      .eq("id", invoiceId)
      .maybeSingle() as unknown as Promise<{
      data: { booking_id: string | null } | null;
    }>,
    db
      .from("invoice_line_items")
      .select("booking_id")
      .eq("invoice_id", invoiceId)
      .not("booking_id", "is", null) as unknown as Promise<{
      data: Array<{ booking_id: string | null }> | null;
    }>,
  ]);

  const bookingIds = [
    ...new Set(
      [inv?.booking_id, ...(liRows ?? []).map((r) => r.booking_id)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  if (bookingIds.length === 0) return null;

  const [{ data: bookings }, { data: entries }] = await Promise.all([
    db
      .from("bookings")
      .select(
        "id, scheduled_at, duration_minutes, status, service_type, service_type_label",
      )
      .in("id", bookingIds) as unknown as Promise<{
      data: Array<{
        id: string;
        scheduled_at: string;
        duration_minutes: number | null;
        status: string;
        service_type: string | null;
        service_type_label: string | null;
      }> | null;
    }>,
    db
      .from("time_entries")
      .select(
        "booking_id, employee_id, clock_in_at, clock_out_at, member:memberships!time_entries_employee_id_fkey ( id, display_name, profile:profiles ( full_name ) )",
      )
      .in("booking_id", bookingIds) as unknown as Promise<{
      data: Array<{
        booking_id: string;
        employee_id: string;
        clock_in_at: string;
        clock_out_at: string | null;
        member: {
          id: string;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        } | null;
      }> | null;
    }>,
  ]);
  if (!bookings || bookings.length === 0) return null;

  const windows = await resolveShiftWindows(bookings);

  const jobs: HoursCheckJob[] = bookings
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .map((b) => {
      const perPerson = new Map<
        string,
        { name: string; minutes: number; open: boolean }
      >();
      for (const e of entries ?? []) {
        if (e.booking_id !== b.id) continue;
        const name = e.member
          ? memberDisplayName({
              display_name: e.member.display_name,
              profile: e.member.profile,
            })
          : "Unknown";
        const cur = perPerson.get(e.employee_id) ?? {
          name,
          minutes: 0,
          open: false,
        };
        if (e.clock_out_at) {
          cur.minutes += Math.max(
            0,
            Math.round(
              (Date.parse(e.clock_out_at) - Date.parse(e.clock_in_at)) /
                60_000,
            ),
          );
        } else {
          cur.open = true;
        }
        perPerson.set(e.employee_id, cur);
      }

      const people: HoursCheckPerson[] = [...perPerson.entries()].map(
        ([membershipId, p]) => {
          const win = windows.get(shiftWindowKey(b.id, membershipId));
          const expected =
            win?.allottedMinutes ?? b.duration_minutes ?? null;
          const delta = expected != null ? p.minutes - expected : null;
          return {
            membershipId,
            name: p.name,
            loggedMinutes: p.minutes,
            expectedMinutes: expected,
            deltaMinutes: delta,
            hasOpenEntry: p.open,
            // An open entry means the number is still moving — don't judge it.
            flagged:
              !p.open &&
              delta != null &&
              Math.abs(delta) > HOURS_TOLERANCE_MINUTES,
          };
        },
      );

      const noHours = people.length === 0 && b.status === "completed";
      return {
        bookingId: b.id,
        scheduledAt: b.scheduled_at,
        serviceLabel: b.service_type_label ?? b.service_type,
        durationMinutes: b.duration_minutes,
        people,
        noHours,
        bookingStatus: b.status,
        flagged: noHours || people.some((p) => p.flagged),
      };
    });

  return { jobs, anyFlagged: jobs.some((j) => j.flagged) };
}
