import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { toEngagement } from "@/lib/engagement";
import {
  closedEntryOverrunMinutes,
  expectedEndMs,
} from "@/lib/shift-overrun";
import { resolveShiftWindows, shiftWindowKey } from "@/lib/crew-hours";
import { getOrgTimezone } from "@/lib/org-timezone";
import {
  zonedDayStartUtc,
  zonedMidnightUtc,
  zonedYmd,
} from "@/lib/wall-clock";
import { maybeDecryptField } from "@/lib/field-encryption";
import { TimesheetsView } from "./timesheets-view";
import type {
  TimesheetEntry,
  EmployeeMeta,
  BookingOption,
} from "./types";

export const metadata = { title: "Timesheets" };

function diffMinutes(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  requireCapability(membership, "timesheets");
  const supabase = await createSupabaseServerClient();
  const params = await searchParams;

  const orgTz = await getOrgTimezone(membership.organization_id);

  // `from`/`to` are CALENDAR DAYS in the org's timezone, and every row below
  // renders in that same zone via formatDateTime(..., orgTz). Both ends have
  // to be resolved through it. Anchoring the window to UTC midnight instead
  // offset it by the zone's whole UTC offset — six hours in Edmonton, seven
  // in winter — so asking for a day actually returned the previous evening
  // through that day's late afternoon. Every shift starting after 6 PM fell
  // out of its own day, showed a date the picker disagreed with, and carried
  // its hours into the neighbouring pay period.
  //
  // Default: current pay period (last 14 days), also in org-local days.
  const now = new Date();
  const to = params.to || zonedYmd(now, orgTz);
  const from =
    params.from || zonedYmd(zonedDayStartUtc(now, orgTz, -14), orgTz);

  // Half-open: [00:00 local on `from`, 00:00 local the day after `to`). An
  // inclusive 23:59:59 end drops the final second of the range.
  const fromIso = zonedMidnightUtc(from, orgTz).toISOString();
  const toIso = zonedDayStartUtc(
    zonedMidnightUtc(to, orgTz),
    orgTz,
    1,
  ).toISOString();

  // Capture "now" once for the booking-picker window below. Single
  // reference point per render keeps the server response deterministic.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const bookingsWindowFrom = new Date(
    nowMs - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const bookingsWindowTo = new Date(
    nowMs + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Fetch time entries with booking + employee details
  const [{ data: entries, error }, { data: employees }, { data: ptoRequests }, { data: recentBookings }] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select(
          `
          id,
          clock_in_at,
          clock_out_at,
          notes,
          employee_id,
          created_manually,
          pay_rate_cents_snapshot,
          engagement_snapshot,
          work_category,
          needs_review,
          auto_closed_at,
          clock_in_lat,
          clock_in_lng,
          clock_out_lat,
          clock_out_lng,
          employee:memberships!time_entries_employee_id_fkey (
            id,
            display_name,
            profile:profiles ( full_name )
          ),
          booking:bookings (
            id,
            scheduled_at,
            duration_minutes,
            service_type,
            total_cents,
            hourly_rate_cents,
            status,
            address,
            client:clients ( name )
          )
        `,
        )
        .gte("clock_in_at", fromIso)
        .lt("clock_in_at", toIso)
        .order("clock_in_at", { ascending: false })
        .limit(1000) as unknown as Promise<{
        data: Array<{
          id: string;
          clock_in_at: string;
          clock_out_at: string | null;
          notes: string | null;
          employee_id: string;
          created_manually: boolean | null;
          pay_rate_cents_snapshot: number | null;
          work_category: string | null;
          needs_review: boolean | null;
          auto_closed_at: string | null;
          clock_in_lat: number | null;
          clock_in_lng: number | null;
          clock_out_lat: number | null;
          clock_out_lng: number | null;
          employee: {
            id: string;
            display_name: string | null;
            profile: { full_name: string | null } | null;
          } | null;
          booking: {
            id: string;
            scheduled_at: string;
            duration_minutes: number;
            service_type: string;
            total_cents: number;
            hourly_rate_cents: number | null;
            status: string;
            address: string | null;
            client: { name: string | null } | null;
          } | null;
        }> | null;
        error: { message: string } | null;
      }>,
      // Previously filtered to employees/managers only. Owners often work
      // shifts themselves (and shadow-added members never have a linked
      // profile), so we pull every active membership and let the UI
      // decide how to present them.
      //
      // Uses admin client because pay_rate_cents is RLS-locked from
      // end-user JWTs (migration 20260601040000). This page is already
      // owner/admin/manager gated via the /app layout, and we filter
      // explicitly to this org so the bypass doesn't leak data.
      createSupabaseAdminClient()
        .from("memberships")
        .select(
          `
          id,
          role,
          pay_rate_cents,
          display_name,
          engagement,
          profile:profiles ( full_name )
        `,
        )
        .eq("status", "active")
        .eq("organization_id", membership.organization_id)
        // Cast because generated types lack `engagement` (types.ts is
        // hand-maintained; same pattern as the employees page).
        .limit(500) as unknown as Promise<{
        data: Array<{
          id: string;
          role: string;
          pay_rate_cents: number | null;
          display_name: string | null;
          engagement: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
      }>,
      // Use admin client: role is already gated above (owner/admin/manager),
      // and RLS on pto_requests may not cover admins viewing others' rows.
      createSupabaseAdminClient()
        .from("pto_requests" as never)
        .select("id, employee_id, start_date, end_date, hours, status, reason, created_at")
        .eq("organization_id" as never, membership.organization_id as never)
        // In-window rows for the timesheet totals, PLUS everything pending
        // (needs review) PLUS anything not yet over (end_date >= today) —
        // the default window is the LAST 14 days, so without that third arm
        // an approved future vacation is invisible on the only screen that
        // can cancel it.
        .or(
          `and(start_date.gte.${from},start_date.lte.${to}),status.eq.pending,end_date.gte.${zonedYmd(now, orgTz)}` as never,
        )
        .order("created_at" as never, { ascending: false } as never)
        .limit(500),
      // Recent bookings — feed the manual time-entry form's booking picker.
      // 90-day window back/forward covers the common "catch up from last
      // month" and "pre-fill for something happening tomorrow" cases.
      supabase
        .from("bookings")
        .select(
          "id, scheduled_at, service_type, client:clients ( name )",
        )
        .gte("scheduled_at", bookingsWindowFrom)
        .lte("scheduled_at", bookingsWindowTo)
        .order("scheduled_at", { ascending: false })
        .limit(500),
    ]);

  if (error) throw error;

  // Build pay_type map from DB (with fallback for pre-migration)
  // For now we treat all as hourly since pay_type column may not exist yet
  const empMeta: Record<string, EmployeeMeta> = {};
  for (const emp of employees ?? []) {
    empMeta[emp.id] = {
      id: emp.id,
      name: memberDisplayName(emp),
      role: emp.role,
      pay_rate_cents: emp.pay_rate_cents ?? 0,
      pay_type: "hourly" as const,
      engagement: toEngagement(
        (emp as { engagement?: string | null }).engagement,
      ),
    };
  }

  // time_entries.notes is encrypted at write; legacy plaintext rows
  // pass through unchanged via maybeDecryptField (imported at top).

  // Per-person allotment for the over-allotted flag. estimated_minutes below
  // is the FULL booking length (what "completion" has always compared
  // against), but the clock-out cron and the field card both measure a
  // person against their SHARE of a team job. Using the full length here
  // would let a cleaner work a 6h two-person job solo, alone, for six hours
  // and show as perfectly on time — while the cron had already flagged them
  // three hours over. Same rule, batched.
  const shiftWindows = await resolveShiftWindows(
    Array.from(
      new Map(
        (entries ?? [])
          .filter((e) => e.booking?.id)
          .map((e) => [
            e.booking!.id,
            {
              id: e.booking!.id,
              duration_minutes: e.booking!.duration_minutes ?? null,
            },
          ]),
      ).values(),
    ),
  );

  // Build entries
  const rows: TimesheetEntry[] = (entries ?? []).map((e) => {
    const isOpen = !e.clock_out_at;
    const actualMinutes =
      e.clock_in_at && e.clock_out_at
        ? diffMinutes(e.clock_in_at, e.clock_out_at)
        : 0;

    const scheduledAt = e.booking?.scheduled_at ?? null;
    const empId = e.employee_id ?? e.employee?.id ?? "";
    // This member's own window on this job: their split segment, or their
    // share of a divided team job. Resolved BEFORE completion because
    // completion has to judge them against it — see below.
    const shiftWindow =
      e.booking?.id && scheduledAt
        ? shiftWindows.get(shiftWindowKey(e.booking.id, empId))
        : undefined;

    // What this person was expected to work — not what the JOB was expected
    // to take. Two cleaners on a 3h job owe 90 minutes each; comparing
    // either of them against the full 3h reported both as finishing an hour
    // and a half early, on every team job, forever. The over-allotted flag
    // and the clock-out cron already measured the share; this was the last
    // number still measuring the whole.
    const estimatedMinutes =
      shiftWindow?.allottedMinutes ?? e.booking?.duration_minutes ?? null;

    // Punctuality: compare clock_in_at vs booking.scheduled_at
    let punctuality: "early" | "on_time" | "late" | null = null;
    let punctualityMinutes = 0;
    if (scheduledAt && e.clock_in_at) {
      const diff =
        (new Date(e.clock_in_at).getTime() -
          new Date(scheduledAt).getTime()) /
        60_000;
      if (diff < -5) {
        punctuality = "early";
        punctualityMinutes = Math.abs(Math.round(diff));
      } else if (diff > 5) {
        punctuality = "late";
        punctualityMinutes = Math.round(diff);
      } else {
        punctuality = "on_time";
      }
    }

    // Completion: compare actual vs what THIS person was allotted.
    let completion: "under" | "on_target" | "over" | null = null;
    let completionDiffMinutes = 0;
    if (estimatedMinutes && actualMinutes > 0) {
      const diff = actualMinutes - estimatedMinutes;
      if (diff < -5) {
        completion = "under";
        completionDiffMinutes = Math.abs(diff);
      } else if (diff > 5) {
        completion = "over";
        completionDiffMinutes = diff;
      } else {
        completion = "on_target";
      }
    }

    // Pay calculation. Precedence (first non-null wins):
    //   1. time_entries.pay_rate_cents_snapshot — locked at clock-in time
    //   2. memberships.pay_rate_cents — current rate (legacy fallback)
    //
    // The booking's hourly rate is the CLIENT'S billing rate (the form's
    // time-and-materials price) and was never a wage. It sat first in this
    // precedence, so a $35/hr-billed job paid the cleaner $35 instead of
    // their $21 — Svit's displayed pay ran $3,087 hot before any run existed.
    // Pay comes from the wage snapshot, then the current wage. A bench
    // offer's flat pay_cents rides its own rails and is untouched.
    // The snapshot path fixes the "raise this month silently re-prices
    // last month's payroll" bug. Legacy entries without a snapshot fall
    // through to the current-rate path, matching old behavior.
    const meta = empMeta[empId];
    const entryRow = e as { pay_rate_cents_snapshot?: number | null };
    const payRateCents =
      entryRow.pay_rate_cents_snapshot ??
      meta?.pay_rate_cents ??
      0;
    const payType = meta?.pay_type ?? "hourly";
    const entryEngagement = toEngagement(
      (e as { engagement_snapshot?: string | null }).engagement_snapshot ??
        meta?.engagement,
    );

    let earnedCents = 0;
    if (payType === "hourly") {
      // Integer-only math to avoid floating-point rounding errors:
      // (minutes * rateCents) / 60 keeps everything in whole numbers until final division
      earnedCents = Math.round((actualMinutes * payRateCents) / 60);
    } else if (payType === "flat") {
      earnedCents = payRateCents;
    } else if (payType === "percent" && e.booking?.total_cents) {
      // payRateCents here is the percentage × 100 (e.g. 1500 = 15%)
      earnedCents = Math.round((e.booking.total_cents * payRateCents) / 10000);
    }

    return {
      id: e.id,
      employee_id: empId,
      employee_name: memberDisplayName(e.employee ?? {}),
      notes: maybeDecryptField(e.notes ?? null),
      is_manual: Boolean(e.created_manually),
      needs_review: Boolean(e.needs_review),
      auto_closed: Boolean(e.auto_closed_at),
      clock_in_at: e.clock_in_at,
      clock_out_at: e.clock_out_at,
      actual_minutes: actualMinutes,
      is_open: isOpen,
      // Booking details
      booking_id: e.booking?.id ?? null,
      work_category: e.work_category ?? null,
      client_name: e.booking?.client?.name ?? null,
      service_type: e.booking?.service_type ?? null,
      scheduled_at: scheduledAt,
      estimated_minutes: estimatedMinutes,
      booking_total_cents: e.booking?.total_cents ?? null,
      booking_address: e.booking?.address ?? null,
      clock_in_lat: e.clock_in_lat ?? null,
      clock_in_lng: e.clock_in_lng ?? null,
      clock_out_lat: e.clock_out_lat ?? null,
      clock_out_lng: e.clock_out_lng ?? null,
      // Analysis
      punctuality,
      punctuality_minutes: punctualityMinutes,
      completion,
      completion_diff_minutes: completionDiffMinutes,
      expected_end_at:
        scheduledAt && e.clock_in_at && (shiftWindow || estimatedMinutes)
          ? new Date(
              expectedEndMs({
                clockInMs: new Date(e.clock_in_at).getTime(),
                scheduledStartMs:
                  new Date(scheduledAt).getTime() +
                  (shiftWindow?.startOffsetMinutes ?? 0) * 60_000,
                scheduledMinutes:
                  shiftWindow?.allottedMinutes ?? estimatedMinutes ?? 0,
              }),
            ).toISOString()
          : null,
      over_allotted_minutes: closedEntryOverrunMinutes({
        clockInIso: e.clock_in_at,
        clockOutIso: e.clock_out_at,
        // Segment-adjusted start, not the booking's. On a split shift the
        // second cleaner's window opens hours after the job does; anchoring
        // to the booking told someone who left 87 minutes early that they
        // ran 33 minutes over.
        scheduledStartIso: shiftWindow
          ? new Date(
              new Date(scheduledAt!).getTime() +
                shiftWindow.startOffsetMinutes * 60_000,
            ).toISOString()
          : scheduledAt,
        scheduledMinutes: shiftWindow?.allottedMinutes ?? estimatedMinutes,
      }),
      // Pay
      pay_rate_cents: payRateCents,
      pay_type: payType,
      earned_cents: earnedCents,
      engagement: entryEngagement,
      attach_suggestion: null as import("./types").TimesheetEntry["attach_suggestion"],
    };
  });

  // Stray punches: closed entries with no job. Offer the assigned job whose
  // window they evidently sat inside — Svitlana taps once, the hours land
  // where they belong, and the hours-check on the invoice starts adding up.
  {
    const { matchStrayEntries } = await import("@/lib/stray-punch-match");
    const strays = rows.filter((e) => !e.booking_id && e.clock_out_at);
    if (strays.length > 0) {
      const matches = await matchStrayEntries(
        supabase,
        strays.map((e) => ({
          id: e.id,
          employee_id: e.employee_id,
          clock_in_at: e.clock_in_at,
          clock_out_at: e.clock_out_at,
          booking_id: e.booking_id,
        })),
      );
      for (const e of rows) {
        const m = matches.get(e.id);
        if (m) {
          e.attach_suggestion = {
            bookingId: m.bookingId,
            clientName: m.clientName,
            scheduledAt: m.scheduledAt,
            candidateCount: m.candidateCount,
          };
        }
      }
    }
  }

  // Booking options for the manual-entry picker.
  const bookingOptions: BookingOption[] = (recentBookings ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    service_type: b.service_type ?? null,
    client_name: b.client?.name ?? "—",
  }));

  // OPEN SHIFTS — entries with clock_out_at IS NULL anywhere in the past
  // (not just inside the date filter — these are the operational fires).
  // Surfaces "Olha clocked in 2 days ago and never clocked out" — the kind
  // of thing that destroys payroll accuracy if left to rot.
  const { data: openShiftsRaw } = (await supabase
    .from("time_entries")
    .select(
      `id, employee_id, clock_in_at,
       booking:bookings ( id, scheduled_at, service_type, client:clients ( name ) )`,
    )
    .is("clock_out_at" as never, null as never)
    .order("clock_in_at", { ascending: true })
    .limit(50)) as unknown as {
    data: Array<{
      id: string;
      employee_id: string;
      clock_in_at: string;
      booking: {
        id: string;
        scheduled_at: string | null;
        service_type: string | null;
        client: { name: string | null } | null;
      } | null;
    }> | null;
  };

  const openShifts = (openShiftsRaw ?? []).map((o) => ({
    id: o.id,
    employee_id: o.employee_id,
    employee_name: empMeta[o.employee_id]?.name ?? "Unknown",
    clock_in_at: o.clock_in_at,
    booking_id: o.booking?.id ?? null,
    client_name: o.booking?.client?.name ?? null,
    service_type: o.booking?.service_type ?? null,
  }));

  // PTO data
  const ptoRows = ((ptoRequests ?? []) as Array<{
    id: string;
    employee_id: string;
    start_date: string;
    end_date: string;
    hours: number;
    status: string;
    reason: string | null;
  }>).map((p) => ({
    id: p.id,
    employee_id: p.employee_id,
    employee_name: empMeta[p.employee_id]?.name ?? "Unknown",
    start_date: p.start_date,
    end_date: p.end_date,
    hours: Number(p.hours),
    status: p.status as "pending" | "approved" | "declined" | "cancelled",
    reason: p.reason,
    engagement: empMeta[p.employee_id]?.engagement ?? "employee",
  }));

  return (
    <PageShell
      title="Timesheets"
      description="Employee hours, job performance, and pay calculations."
    >
      <TimesheetsView
        entries={rows}
        employees={empMeta}
        ptoEntries={ptoRows}
        bookings={bookingOptions}
        openShifts={openShifts}
        orgTz={orgTz}
        from={from}
        to={to}
      />
    </PageShell>
  );
}
