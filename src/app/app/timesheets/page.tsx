import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";
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
  const supabase = await createSupabaseServerClient();
  const params = await searchParams;

  // Default: current pay period (last 14 days)
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 14);

  const from = params.from || defaultFrom.toISOString().slice(0, 10);
  const to = params.to || now.toISOString().slice(0, 10);

  const fromIso = `${from}T00:00:00Z`;
  const toIso = `${to}T23:59:59Z`;

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
          employee:memberships!time_entries_employee_id_fkey (
            id,
            pay_rate_cents,
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
            client:clients ( name )
          )
        `,
        )
        .gte("clock_in_at", fromIso)
        .lte("clock_in_at", toIso)
        .order("clock_in_at", { ascending: false })
        .limit(1000),
      // Previously filtered to employees/managers only. Owners often work
      // shifts themselves (and shadow-added members never have a linked
      // profile), so we pull every active membership and let the UI
      // decide how to present them.
      supabase
        .from("memberships")
        .select(
          `
          id,
          role,
          pay_rate_cents,
          display_name,
          profile:profiles ( full_name )
        `,
        )
        .eq("status", "active")
        .limit(500),
      // Use admin client: role is already gated above (owner/admin/manager),
      // and RLS on pto_requests may not cover admins viewing others' rows.
      createSupabaseAdminClient()
        .from("pto_requests" as never)
        .select("id, employee_id, start_date, end_date, hours, status, reason, created_at")
        .eq("organization_id" as never, membership.organization_id as never)
        .or(`and(start_date.gte.${from},start_date.lte.${to}),status.eq.pending` as never)
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
    };
  }

  // Build entries
  const rows: TimesheetEntry[] = (entries ?? []).map((e) => {
    const isOpen = !e.clock_out_at;
    const actualMinutes =
      e.clock_in_at && e.clock_out_at
        ? diffMinutes(e.clock_in_at, e.clock_out_at)
        : 0;

    const scheduledAt = e.booking?.scheduled_at ?? null;
    const estimatedMinutes = e.booking?.duration_minutes ?? null;

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

    // Completion: compare actual vs estimated duration
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

    // Pay calculation
    const empId = e.employee_id ?? e.employee?.id ?? "";
    const meta = empMeta[empId];
    const payRateCents = e.booking?.hourly_rate_cents ?? meta?.pay_rate_cents ?? 0;
    const payType = meta?.pay_type ?? "hourly";

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
      notes: e.notes ?? null,
      is_manual: Boolean(e.created_manually),
      clock_in_at: e.clock_in_at,
      clock_out_at: e.clock_out_at,
      actual_minutes: actualMinutes,
      is_open: isOpen,
      // Booking details
      booking_id: e.booking?.id ?? null,
      client_name: e.booking?.client?.name ?? null,
      service_type: e.booking?.service_type ?? null,
      scheduled_at: scheduledAt,
      estimated_minutes: estimatedMinutes,
      booking_total_cents: e.booking?.total_cents ?? null,
      // Analysis
      punctuality,
      punctuality_minutes: punctualityMinutes,
      completion,
      completion_diff_minutes: completionDiffMinutes,
      // Pay
      pay_rate_cents: payRateCents,
      pay_type: payType,
      earned_cents: earnedCents,
    };
  });

  // Booking options for the manual-entry picker.
  const bookingOptions: BookingOption[] = (recentBookings ?? []).map((b) => ({
    id: b.id,
    scheduled_at: b.scheduled_at,
    service_type: b.service_type ?? null,
    client_name: b.client?.name ?? "—",
  }));

  const orgTz = await getOrgTimezone(membership.organization_id);

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
        orgTz={orgTz}
        from={from}
        to={to}
      />
    </PageShell>
  );
}
